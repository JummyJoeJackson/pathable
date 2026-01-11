import os
import re
import random
import polyline
import googlemaps
from flask_cors import CORS
from flask import Flask, jsonify, request
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from openai import OpenAI

load_dotenv()

app = Flask(__name__)
CORS(app)

API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
if not API_KEY:
    raise ValueError("No GOOGLE_MAPS_API_KEY found in environment variables")

FIREBASE_SA_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
if not FIREBASE_SA_PATH:
    raise ValueError("No FIREBASE_SERVICE_ACCOUNT_JSON found in environment variables")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("No OPENAI_API_KEY found in environment variables")

SUMMARY_MODEL = os.getenv("SUMMARY_MODEL", "gpt-4o-mini")

gmaps = googlemaps.Client(key=API_KEY)

if not firebase_admin._apps:
    cred = credentials.Certificate(FIREBASE_SA_PATH)
    firebase_admin.initialize_app(cred)

fs = firestore.client()

oai = OpenAI(api_key=OPENAI_API_KEY)


# randomize accessibility rating for demonstration purposes (legacy)
def compute_accessibility_rating(details):
    score = 1.5
    features = []

    feature_weights = [
        ("wheelchairAccessibleEntrance", "Accessible Entrance", 1.0),
        ("wheelchairAccessibleRestroom", "Accessible Restroom", 0.8),
        ("wheelchairAccessibleSeating", "Accessible Seating", 0.6),
        ("wheelchairAccessibleParking", "Accessible Parking", 0.6),
        ("elevator", "Elevator", 0.6),
    ]

    for key, label, boost in feature_weights:
        if random.random() > 0.5:
            score += boost
            features.append(label)

    score += random.uniform(-0.2, 0.2)

    return {
        "rating": round(min(5.0, max(1.0, score)), 1),
        "features": features,
    }


# Get places based on query
@app.route("/api/places", methods=["GET"])
def get_places():
    query_text = request.args.get("query", "")
    if not query_text:
        return jsonify({"error": "Query parameter is required"}), 400

    try:
        search_result = gmaps.places(query=query_text)
        results = []

        # Limit to top 10 for speed/cost
        for place in search_result.get("results", [])[:10]:
            place_id = place["place_id"]
            lat = place["geometry"]["location"]["lat"]
            lng = place["geometry"]["location"]["lng"]
            name = place["name"]
            address = place.get("formatted_address", "")

            rating_data = compute_accessibility_rating({})

            results.append(
                {
                    "place_id": place_id,
                    "name": name,
                    "address": address,
                    "lat": lat,
                    "lng": lng,
                    "rating": rating_data["rating"],
                    "features": rating_data["features"],
                }
            )

        return jsonify(results)

    except Exception as e:
        print(f"Error in /api/places: {e}")
        return jsonify({"error": str(e)}), 500


# Get directions based on origin/destination (+ optional waypoint)
@app.route("/api/directions", methods=["GET"])
def get_directions():
    origin = request.args.get("origin")
    destination = request.args.get("destination")
    waypoint = request.args.get("waypoint")  # expects "lat,lng" like "43.2609,-79.9192"

    if not origin or not destination:
        return jsonify({"error": "Origin and Destination are required"}), 400

    try:
        # If waypoint is provided, route must pass through it
        if waypoint:
            directions_result = gmaps.directions(
                origin,
                destination,
                mode="walking",
                waypoints=[waypoint],
            )
        else:
            directions_result = gmaps.directions(origin, destination, mode="walking")

        if not directions_result:
            return jsonify({"error": "No route found"}), 404

        route = directions_result[0]
        legs = route["legs"][0]

        steps = []
        for step in legs["steps"]:
            instruction = step["html_instructions"]
            clean_instruction = re.sub("<[^<]+?>", "", instruction)
            steps.append(
                {
                    "instruction": clean_instruction,
                    "distance": step["distance"]["text"],
                    "duration": step["duration"]["text"],
                }
            )

        overview_polyline = route["overview_polyline"]["points"]
        decoded_points = polyline.decode(overview_polyline)
        path_points = [{"latitude": lat, "longitude": lng} for lat, lng in decoded_points]

        ramp_used = bool(waypoint)
        features_used = []
        if ramp_used:
            features_used.append("Waypoint ramp used")

        return jsonify(
            {
                "points": path_points,
                "steps": steps,
                "duration": legs["duration"]["text"],
                "distance": legs["distance"]["text"],
                "ramp_used": ramp_used,
                "features_used": features_used
            }
        )

    except Exception as e:
        print(f"Error in /api/directions: {e}")
        return jsonify({"error": str(e)}), 500


# Get summary based on place_id
@app.route("/api/summary", methods=["GET"])
def get_summary():
    place_id = request.args.get("place_id", "").strip()
    if not place_id:
        return jsonify({"error": "place_id is required"}), 400

    try:
        # 1) Pull latest reviews for this place (only ones with non-empty text)
        reviews_ref = fs.collection("reviews")
        q = (
            reviews_ref.where("place_id", "==", place_id)
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(50)
        )
        docs = list(q.stream())

        written = []
        latest_ts = None

        for d in docs:
            data = d.to_dict() or {}
            text = (data.get("text") or "").strip()
            ts = data.get("created_at")
            if ts and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
            if text:
                written.append(text)

        # If nobody wrote anything, return empty summary (no GPT call)
        if len(written) == 0:
            return jsonify(
                {
                    "place_id": place_id,
                    "summary": "",
                    "source_review_count": 0,
                    "cached": True,
                }
            )

        source_review_count = len(written)
        source_latest_review_at = latest_ts

        # 2) Check cache doc
        cache_doc_ref = fs.collection("place_summaries").document(place_id)
        cache_snap = cache_doc_ref.get()

        if cache_snap.exists:
            cache = cache_snap.to_dict() or {}
            cache_summary = (cache.get("summary") or "").strip()

            # Cache is valid if it matches current written-review state
            if (
                cache_summary
                and cache.get("source_review_count") == source_review_count
                and cache.get("source_latest_review_at") == source_latest_review_at
            ):
                return jsonify(
                    {
                        "place_id": place_id,
                        "summary": cache_summary,
                        "source_review_count": cache.get("source_review_count", source_review_count),
                        "cached": True,
                        "updated_at": cache.get("updated_at"),
                    }
                )

        # 3) Generate a new summary with GPT (bounded input)
        recent_texts = written[:20]  # cost control

        prompt = (
    "Summarize the accessibility feedback below in **2-3 concise sentences**.\n"
    "Use ONLY the provided review text.\n"
    "Focus on the most important recurring accessibility issues or positives.\n"
    "If there is disagreement, briefly mention it.\n"
    "Write in a neutral, factual tone suitable for a map app.\n"
    "Do NOT use bullet points.\n"
    "Keep it under 35 words.\n\n"
    "REVIEWS:\n"
    + "\n---\n".join(recent_texts)
)


        resp = oai.responses.create(
            model=SUMMARY_MODEL,
            input=prompt,
        )
        summary_text = (resp.output_text or "").strip()

        # 4) Store cache
        cache_doc_ref.set(
            {
                "place_id": place_id,
                "summary": summary_text,
                "model": SUMMARY_MODEL,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "source_review_count": source_review_count,
                "source_latest_review_at": source_latest_review_at,
            },
            merge=True,
        )

        return jsonify(
            {
                "place_id": place_id,
                "summary": summary_text,
                "source_review_count": source_review_count,
                "cached": False,
            }
        )

    except Exception as e:
        print(f"Error in /api/summary: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0")
