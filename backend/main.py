import os
import re
import random
import polyline
import googlemaps
from flask_cors import CORS
from flask import Flask, jsonify, request
from dotenv import load_dotenv


load_dotenv()

app = Flask(__name__)
CORS(app)

API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
if not API_KEY:
    raise ValueError("No GOOGLE_MAPS_API_KEY found in environment variables")

gmaps = googlemaps.Client(key=API_KEY)


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


if __name__ == "__main__":
    app.run(debug=True, port=5001, host="0.0.0.0")
