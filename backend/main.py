import os
import re
import polyline
import googlemaps
import firebase_admin
from flask_cors import CORS
from flask import Flask, jsonify, request
from dotenv import load_dotenv
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

db = firestore.client()
openai_client = OpenAI(api_key=OPENAI_API_KEY)


@app.route("/api/places", methods=["GET"])
def get_places():
    """Search for places using the Google Places API and enrich with mock accessibility data."""
    query_text = request.args.get("query", "")
    if not query_text:
        return jsonify({"error": "Query parameter is required"}), 400

    try:
        search_result = gmaps.places(query=query_text)
        results = []

        for place in search_result.get("results", [])[:10]:
            results.append({
                "place_id": place["place_id"],
                "name": place["name"],
                "address": place.get("formatted_address", ""),
                "lat": place["geometry"]["location"]["lat"],
                "lng": place["geometry"]["location"]["lng"]
            })

        return jsonify(results)

    except Exception as e:
        print(f"Error in /api/places: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/directions", methods=["GET"])
def get_directions():
    """Calculate walking directions, optionally passing through a specific ramp/waypoint."""
    origin = request.args.get("origin")
    destination = request.args.get("destination")
    waypoint = request.args.get("waypoint")

    if not origin or not destination:
        return jsonify({"error": "Origin and Destination are required"}), 400

    try:
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

        route_data = directions_result[0]
        leg = route_data["legs"][0]

        steps = []
        for step in leg["steps"]:
            instruction = re.sub("<[^<]+?>", "", step["html_instructions"])
            steps.append({
                "instruction": instruction,
                "distance": step["distance"]["text"],
                "duration": step["duration"]["text"],
            })

        decoded_points = polyline.decode(route_data["overview_polyline"]["points"])
        path_points = [{"latitude": lat, "longitude": lng} for lat, lng in decoded_points]

        return jsonify({
            "points": path_points,
            "steps": steps,
            "duration": leg["duration"]["text"],
            "distance": leg["distance"]["text"],
            "ramp_used": bool(waypoint),
            "features_used": ["Waypoint ramp used"] if waypoint else []
        })

    except Exception as e:
        print(f"Error in /api/directions: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/summary", methods=["GET"])
def get_summary():
    """Retrieve an AI-generated accessibility summary based on community reviews."""
    place_id = request.args.get("place_id", "").strip()
    if not place_id:
        return jsonify({"error": "place_id is required"}), 400

    try:
        reviews_ref = db.collection("reviews")
        query = (
            reviews_ref.where("place_id", "==", place_id)
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(50)
        )
        docs = list(query.stream())

        review_texts = []
        latest_ts = None

        for d in docs:
            data = d.to_dict() or {}
            text = (data.get("text") or "").strip()
            ts = data.get("created_at")
            if ts and (latest_ts is None or ts > latest_ts):
                latest_ts = ts
            if text:
                review_texts.append(text)

        if not review_texts:
            return jsonify({
                "place_id": place_id,
                "summary": "",
                "source_review_count": 0,
                "cached": True,
            })

        source_review_count = len(review_texts)
        source_latest_review_at = latest_ts

        cache_doc_ref = db.collection("place_summaries").document(place_id)
        cache_snap = cache_doc_ref.get()

        if cache_snap.exists:
            cache = cache_snap.to_dict() or {}
            cache_summary = (cache.get("summary") or "").strip()

            if (
                cache_summary
                and cache.get("source_review_count") == source_review_count
                and cache.get("source_latest_review_at") == source_latest_review_at
            ):
                return jsonify({
                    "place_id": place_id,
                    "summary": cache_summary,
                    "source_review_count": cache.get("source_review_count", source_review_count),
                    "cached": True,
                    "updated_at": cache.get("updated_at"),
                })

        truncated_reviews = review_texts[:20]
        prompt = (
            "Summarize the accessibility feedback below in **2-3 concise sentences**.\n"
            "Use ONLY the provided review text.\n"
            "Focus on the most important recurring accessibility issues or positives.\n"
            "If there is disagreement, briefly mention it.\n"
            "Write in a neutral, factual tone suitable for a map app.\n"
            "Do NOT use bullet points.\n"
            "Keep it under 35 words.\n\n"
            "REVIEWS:\n"
            + "\n---\n".join(truncated_reviews)
        )

        response = openai_client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[{"role": "user", "content": prompt}]
        )
        summary_text = response.choices[0].message.content.strip()

        cache_doc_ref.set({
            "place_id": place_id,
            "summary": summary_text,
            "model": SUMMARY_MODEL,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "source_review_count": source_review_count,
            "source_latest_review_at": source_latest_review_at,
        }, merge=True)

        return jsonify({
            "place_id": place_id,
            "summary": summary_text,
            "source_review_count": source_review_count,
            "cached": False,
        })

    except Exception as e:
        print(f"Error in /api/summary: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0")
