import React, { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Callout, Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { db } from "./firebase";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";


const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:5000";

interface Place {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number; // legacy demo
  features?: string[];
}

interface RouteStep {
  instruction: string;
  distance: string;
  duration: string;
}

const CATEGORIES = ["washrooms", "entrances", "elevators", "seating", "parking"] as const;

const FILTER_OPTIONS = [
  "Accessible Entrance",
  "Accessible Restroom",
  "Accessible Seating",
  "Accessible Parking",
  "Elevator",
];

const FILTER_TO_CATEGORY: Record<string, (typeof CATEGORIES)[number]> = {
  "Accessible Entrance": "entrances",
  "Accessible Restroom": "washrooms",
  "Accessible Seating": "seating",
  "Accessible Parking": "parking",
  "Elevator": "elevators",
};



const prettyCategory = (k: string) => {
  const map: Record<string, string> = {
    washrooms: "Accessible washrooms",
    entrances: "Wide entrances",
    elevators: "Elevators",
    seating: "Seating",
    parking: "Parking",
  };
  return map[k] ?? k;
};

// ---- Stars (display) ----
const StarRow = ({ value }: { value: number }) => {
  const v = Math.max(0, Math.min(5, value));
  const full = Math.floor(v);
  const half = v - full >= 0.5;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {[0, 1, 2, 3, 4].map((i) => {
        let icon: any = "star-outline";
        if (i < full) icon = "star";
        else if (i === full && half) icon = "star-half";
        return (
          <Ionicons
            key={i}
            name={icon}
            size={18}
            color="#f5c518"
            style={{ marginRight: 2 }}
          />
        );
      })}
      <Text style={{ marginLeft: 6, fontWeight: "bold" }}>{v.toFixed(1)}</Text>
    </View>
  );
};

// ---- Stars (input) ----
const StarInput = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) => {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <TouchableOpacity
          key={i}
          onPress={() => onChange(i)}
          style={{ padding: 4 }}
          activeOpacity={0.7}
        >
          <Ionicons name={i <= value ? "star" : "star-outline"} size={28} color="#f5c518" />
        </TouchableOpacity>
      ))}
      <Text style={{ marginLeft: 6, fontWeight: "bold" }}>{value}/5</Text>
    </View>
  );
};

// ---- distance helper (meters-ish, good enough) ----
const distMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const x = (bLng - aLng) * 111320 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const y = (bLat - aLat) * 110540;
  return Math.sqrt(x * x + y * y);
};

export default function App() {
  // ---- Reviews ----
  const [avgRatings, setAvgRatings] = useState<Record<string, number>>({});
  const [reviewCount, setReviewCount] = useState(0);
  const reviewsUnsubRef = useRef<null | (() => void)>(null);

  // ---- Ramps ----
  const [ramps, setRamps] = useState<{ id: string; lat: number; lng: number }[]>([]);
  const [addRampMode, setAddRampMode] = useState(false);

  // ---- Modals ----
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);

  // ---- User input ratings ----
  const [myRatings, setMyRatings] = useState<Record<string, number>>({
    washrooms: 0,
    entrances: 0,
    elevators: 0,
    seating: 0,
    parking: 0,
  });

  // ---- Search/filter ----
  const [queryText, setQueryText] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [placesAverages, setPlacesAverages] = useState<Record<string, Record<string, number>>>({});



  // ---- Routing ----
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [route, setRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [isRouting, setIsRouting] = useState(false);
  const [routeStats, setRouteStats] = useState<{
    distance: string;
    duration: string;
    rampUsed: boolean;
    waypoint?: string;
  } | null>(null);

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const mapRef = useRef<MapView>(null);

  // ---- Location permission ----
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission to access location was denied");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
    })();
  }, []);

  // ---- Subscribe ramps (real-time) ----
  useEffect(() => {
    const q = query(collection(db, "ramps"), orderBy("created_at", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const out: { id: string; lat: number; lng: number }[] = [];
        snap.forEach((doc) => {
          const d: any = doc.data();
          if (typeof d.lat === "number" && typeof d.lng === "number") {
            out.push({ id: doc.id, lat: d.lat, lng: d.lng });
          }
        });
        setRamps(out);
      },
      (err) => console.error(err)
    );
    return () => unsub();
  }, []);

  // ---- Subscribe to reviews for ALL places (for filtering) ----
  useEffect(() => {
    if (places.length === 0) {
      setPlacesAverages({});
      return;
    }

    const placeIds = Array.from(new Set(places.map((p) => p.place_id)));
    const q = query(
      collection(db, "reviews"),
      where("place_id", "in", placeIds)
    );

    const unsub = onSnapshot(q, (snap) => {
      const grouped: Record<string, Record<string, { sum: number; count: number }>> = {};

      placeIds.forEach((id) => {
        grouped[id] = {};
        CATEGORIES.forEach((c) => (grouped[id][c] = { sum: 0, count: 0 }));
      });

      snap.forEach((doc) => {
        const data: any = doc.data();
        const pid = data.place_id;
        const ratings = data.ratings || {};
        if (grouped[pid]) {
          CATEGORIES.forEach((c) => {
            const v = ratings[c];
            if (typeof v === "number") {
              grouped[pid][c].sum += v;
              grouped[pid][c].count += 1;
            }
          });
        }
      });

      const newAvgs: Record<string, Record<string, number>> = {};
      placeIds.forEach((id) => {
        newAvgs[id] = {};
        CATEGORIES.forEach((c) => {
          // If no ratings, count as 0 stars (per user request)
          newAvgs[id][c] = grouped[id][c].count > 0 ? (grouped[id][c].sum / grouped[id][c].count) : 0;
        });
      });
      setPlacesAverages(newAvgs);
    });

    return () => unsub();
  }, [places]);

  // Cleanup reviews listener on unmount

  useEffect(() => {
    return () => {
      if (reviewsUnsubRef.current) reviewsUnsubRef.current();
    };
  }, []);

  // ---- Reviews ----
  const addReview = async (place: Place, ratings: Record<string, number>) => {
    try {
      await addDoc(collection(db, "reviews"), {
        place_id: place.place_id,
        ratings,
        created_at: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Could not submit review.");
    }
  };

  const subscribeToReviews = (placeId: string) => {
    if (reviewsUnsubRef.current) reviewsUnsubRef.current();

    const q = query(
      collection(db, "reviews"),
      where("place_id", "==", placeId),
      orderBy("created_at", "desc")
    );

    reviewsUnsubRef.current = onSnapshot(
      q,
      (snap) => {
        setReviewCount(snap.size);

        const sums: Record<string, number> = {};
        const counts: Record<string, number> = {};
        CATEGORIES.forEach((c) => {
          sums[c] = 0;
          counts[c] = 0;
        });

        snap.forEach((doc) => {
          const data: any = doc.data();
          const ratings = data.ratings || {};
          CATEGORIES.forEach((c) => {
            const v = ratings[c];
            if (typeof v === "number") {
              sums[c] += v;
              counts[c] += 1;
            }
          });
        });

        const avgs: Record<string, number> = {};
        CATEGORIES.forEach((c) => {
          avgs[c] = counts[c] ? Math.round((sums[c] / counts[c]) * 10) / 10 : 0;
        });

        setAvgRatings(avgs);
      },
      (err) => {
        console.error(err);
        Alert.alert("Error", "Failed to load reviews.");
      }
    );
  };

  const overallAvg =
    CATEGORIES.reduce((sum, k) => sum + (avgRatings[k] ?? 0), 0) / CATEGORIES.length;
  const overallDisplay = reviewCount === 0 ? 0 : Number.isFinite(overallAvg) ? overallAvg : 0;

  // ---- Ramps: add ----
  const addRamp = async (lat: number, lng: number) => {
    try {
      await addDoc(collection(db, "ramps"), {
        lat,
        lng,
        created_at: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Could not add ramp.");
    }
  };

  // ---- Backend: search places ----
  const searchPlaces = async () => {
    if (!queryText.trim()) return;
    Keyboard.dismiss();
    setLoading(true);

    // reset selection + routing
    setRoute([]);
    setRouteSteps([]);
    setIsRouting(false);
    setRouteStats(null);
    setSelectedPlace(null);
    setDetailsOpen(false);
    setRateOpen(false);

    if (reviewsUnsubRef.current) reviewsUnsubRef.current();
    setAvgRatings({});
    setReviewCount(0);

    try {
      const response = await fetch(`${API_URL}/api/places?query=${encodeURIComponent(queryText)}`);
      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();

      if (data.error) {
        Alert.alert("Error", data.error);
        return;
      }

      setPlaces(data);

      if (data.length > 0) {
        mapRef.current?.animateToRegion(
          {
            latitude: data[0].lat,
            longitude: data[0].lng,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          },
          800
        );
      }
    } catch (error) {
      console.error("Error fetching places:", error);
      Alert.alert("Error", "Failed to connect to backend.");
    } finally {
      setLoading(false);
    }
  };

  // ---- Backend: get directions (supports waypoint) ----
  const getDirections = async (destination: Place, waypoint?: { lat: number; lng: number }) => {
    if (!location) throw new Error("No location yet");

    const originStr = `${location.coords.latitude},${location.coords.longitude}`;
    const destStr = `${destination.lat},${destination.lng}`;

    const url =
      waypoint
        ? `${API_URL}/api/directions?origin=${originStr}&destination=${destStr}&waypoint=${waypoint.lat},${waypoint.lng}`
        : `${API_URL}/api/directions?origin=${originStr}&destination=${destStr}`;

    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    return data as {
      points: { latitude: number; longitude: number }[];
      steps: RouteStep[];
      duration: string;
      distance: string;
      ramp_used: boolean;
      features_used?: string[];
    };
  };

  // ---- Prefer ramps (stronger) ----
  const fetchDirectionsPreferRamps = async (destination: Place) => {
    if (!location) {
      Alert.alert("Error", "Waiting for your location...");
      return;
    }

    setLoading(true);

    try {
      const originLat = location.coords.latitude;
      const originLng = location.coords.longitude;

      // 1) Direct route
      const direct = await getDirections(destination);

      const routeLength = (pts: { latitude: number; longitude: number }[]) => {
        if (!pts || pts.length < 2) return Number.POSITIVE_INFINITY;
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
          total += distMeters(
            pts[i - 1].latitude,
            pts[i - 1].longitude,
            pts[i].latitude,
            pts[i].longitude
          );
        }
        return total;
      };

      const directLen = routeLength(direct.points);


      const candidates = ramps
        .map((r) => ({
          ...r,
          score:
            distMeters(originLat, originLng, r.lat, r.lng) +
            distMeters(r.lat, r.lng, destination.lat, destination.lng),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 6); // try more


      const MAX_MULTIPLIER = 1.35;

      let best = {
        data: direct,
        usedRamp: false,
        waypointLabel: undefined as string | undefined,
        len: directLen,
      };

      for (const r of candidates) {
        try {
          const data = await getDirections(destination, { lat: r.lat, lng: r.lng });
          const len = routeLength(data.points);


          if (len <= directLen * MAX_MULTIPLIER) {
            best = {
              data,
              usedRamp: true,
              waypointLabel: `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
              len,
            };
            break;
          }


          if (len < best.len) {
            best = {
              data,
              usedRamp: true,
              waypointLabel: `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
              len,
            };
          }
        } catch {
          // ignore ramp failures
        }
      }

      setRoute(best.data.points);
      setRouteSteps(best.data.steps);
      setRouteStats({
        distance: best.data.distance,
        duration: best.data.duration,
        rampUsed: best.usedRamp,
        waypoint: best.waypointLabel,
      });
      setIsRouting(true);

      mapRef.current?.fitToCoordinates(best.data.points, {
        edgePadding: { top: 50, right: 50, bottom: 300, left: 50 },
        animated: true,
      });
    } catch (error: any) {
      console.error("Error fetching directions:", error);
      Alert.alert("Error", error?.message ?? "Failed to fetch directions.");
    } finally {
      setLoading(false);
    }
  };

  const toggleFilter = (filter: string) => {
    if (selectedFilters.includes(filter)) {
      setSelectedFilters(selectedFilters.filter((f) => f !== filter));
    } else {
      setSelectedFilters([...selectedFilters, filter]);
    }
  };

  const filteredPlaces = places.filter((place) => {
    if (selectedFilters.length === 0) return true;
    const avgs = placesAverages[place.place_id] || {};
    return selectedFilters.every((filter) => {
      const cat = FILTER_TO_CATEGORY[filter];
      const score = avgs[cat] ?? 0; // count as 0 if unrated
      return score > 2.5;
    });
  });

  const showFab = !detailsOpen && !rateOpen && !isRouting;



  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: 43.6532,
            longitude: -79.3832,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          showsUserLocation
          showsMyLocationButton
          onUserLocationChange={(e) => setLocation({ ...location, coords: e.nativeEvent.coordinate } as any)}
          onPress={(e) => {
            if (!addRampMode) return;

            const { latitude, longitude } = e.nativeEvent.coordinate;
            Alert.alert(
              "Add ramp here?",
              `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Add",
                  onPress: () => {
                    addRamp(latitude, longitude);
                    setAddRampMode(false);
                  },
                },
              ]
            );
          }}
        >
          {/* Places */}
          {filteredPlaces.map((place, idx) => (

            <Marker
              key={`${place.place_id}-${idx}`}
              coordinate={{ latitude: place.lat, longitude: place.lng }}
              title={place.name}
              onPress={() => {
                setSelectedPlace(place);
                subscribeToReviews(place.place_id);
                setDetailsOpen(true);
              }}
            >

              <Callout tooltip>
                <View style={styles.calloutContainer}>
                  <Text style={styles.calloutTitle}>{place.name}</Text>
                  <Text style={styles.calloutAddress}>{place.address}</Text>
                  <View style={[styles.calloutButton, { marginTop: 10 }]}>
                    <Text style={styles.calloutButtonText}>Tap marker for details</Text>
                  </View>
                </View>
              </Callout>
            </Marker>
          ))}

          {/* Ramps */}
          {ramps.map((r) => (
            <Marker
              key={r.id}
              coordinate={{ latitude: r.lat, longitude: r.lng }}
              title="Ramp"
              pinColor="#28a745"
            />
          ))}

          { }
          {isRouting && route.length > 0 && (
            <Polyline coordinates={route} strokeColor="#007AFF" strokeWidth={5} />
          )}
        </MapView>

        { }
        {showFab && (
          <View style={styles.fabContainer}>
            <TouchableOpacity
              style={[styles.fab, addRampMode && { backgroundColor: "#28a745" }]}
              onPress={() => {
                setAddRampMode((v) => !v);
                Alert.alert(
                  addRampMode ? "Ramp mode off" : "Ramp mode on",
                  addRampMode ? "Normal map mode." : "Tap anywhere on the map to drop a ramp pin."
                );
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="accessibility" size={22} color="white" />
              <Text style={styles.fabText}>{addRampMode ? "Tap map" : "Add Ramp"}</Text>
            </TouchableOpacity>
          </View>
        )}

        { }
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.input}
              placeholder="Search (e.g. McMaster, Library, Restaurant)..."
              value={queryText}
              onChangeText={setQueryText}
              onSubmitEditing={searchPlaces}
              returnKeyType="search"
            />
            <TouchableOpacity onPress={() => setFilterVisible(true)} style={styles.filterButton}>
              <Ionicons
                name="filter"
                size={24}
                color={selectedFilters.length > 0 ? "#007AFF" : "#666"}
              />
            </TouchableOpacity>


            <TouchableOpacity style={styles.button} onPress={searchPlaces} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.buttonText}>Search</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Filter Modal */}
        <Modal
          animationType="slide"
          transparent
          visible={filterVisible}
          onRequestClose={() => setFilterVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Filter by Features</Text>
                <TouchableOpacity onPress={() => setFilterVisible(false)}>
                  <Ionicons name="close" size={24} color="#000" />
                </TouchableOpacity>
              </View>

              <ScrollView>
                {FILTER_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={styles.filterOption}
                    onPress={() => toggleFilter(option)}
                  >
                    <Text style={styles.filterText}>{option}</Text>
                    {selectedFilters.includes(option) && (
                      <Ionicons name="checkmark-circle" size={24} color="#007AFF" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={styles.applyButton}
                onPress={() => setFilterVisible(false)}
              >
                <Text style={styles.applyButtonText}>
                  Apply Filters ({selectedFilters.length})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Details Modal */}


        <Modal visible={detailsOpen} animationType="slide" transparent onRequestClose={() => setDetailsOpen(false)}>
          <View style={styles.sheetOverlay} pointerEvents="box-none">
            <View style={styles.sheet} pointerEvents="auto">
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.sheetTitle}>{selectedPlace?.name ?? "Place"}</Text>
                  <Text style={styles.sheetSub}>{selectedPlace?.address ?? ""}</Text>
                </View>
                <TouchableOpacity onPress={() => setDetailsOpen(false)} activeOpacity={0.7}>
                  <Ionicons name="close" size={26} color="#666" />
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 12 }}>
                <Text style={{ fontWeight: "bold", marginBottom: 6 }}>Overall accessibility</Text>

                {reviewCount === 0 ? (
                  <Text style={{ color: "#666" }}>No reviews yet — be the first.</Text>
                ) : (
                  <StarRow value={overallDisplay} />
                )}

                <Text style={{ color: "#666", marginTop: 6 }}>
                  {reviewCount === 0
                    ? "Ratings will appear here once someone submits a review."
                    : `Based on ${reviewCount} review${reviewCount === 1 ? "" : "s"}`}
                </Text>
              </View>

              {/* Buttons */}
              <View style={{ flexDirection: "row", marginTop: 14 }}>
                <TouchableOpacity
                  style={[styles.primaryBtn, { flex: 1, marginRight: 8 }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (!selectedPlace) return;
                    setDetailsOpen(false);
                    setTimeout(() => fetchDirectionsPreferRamps(selectedPlace), 150);
                  }}
                >
                  <Text style={styles.primaryBtnText}>Navigate</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryBtn, { flex: 1, backgroundColor: "#28a745", marginLeft: 8 }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    setDetailsOpen(false);
                    setTimeout(() => {
                      setMyRatings({
                        washrooms: 0,
                        entrances: 0,
                        elevators: 0,
                        seating: 0,
                        parking: 0,
                      });
                      setRateOpen(true);
                    }, 200);
                  }}
                >
                  <Text style={styles.primaryBtnText}>Rate</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ fontWeight: "bold", marginTop: 18, marginBottom: 8 }}>Category ratings</Text>

              <ScrollView style={{ flex: 1 }}>
                {CATEGORIES.map((k) => (
                  <View key={k} style={styles.categoryRow}>
                    <Text style={styles.categoryLabel}>{prettyCategory(k)}</Text>
                    {reviewCount === 0 ? (
                      <Text style={{ color: "#666" }}>—</Text>
                    ) : (
                      <StarRow value={avgRatings[k] ?? 0} />
                    )}
                  </View>
                ))}
                <View style={{ height: 20 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Rate Modal */}
        <Modal visible={rateOpen} animationType="slide" transparent onRequestClose={() => setRateOpen(false)}>
          <View style={styles.sheetOverlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.sheetTitle}>Rate this place</Text>
                  <Text style={styles.sheetSub}>{selectedPlace?.name ?? ""}</Text>
                </View>
                <TouchableOpacity onPress={() => setRateOpen(false)} activeOpacity={0.7}>
                  <Ionicons name="close" size={26} color="#666" />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1, marginTop: 10 }}>
                {CATEGORIES.map((k) => (
                  <View key={k} style={styles.rateRow}>
                    <Text style={styles.rateLabel}>{prettyCategory(k)}</Text>
                    <StarInput
                      value={myRatings[k] ?? 0}
                      onChange={(n) => setMyRatings((prev) => ({ ...prev, [k]: n }))}
                    />
                  </View>
                ))}
                <View style={{ height: 110 }} />
              </ScrollView>

              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 10 }]}
                activeOpacity={0.85}
                onPress={async () => {
                  if (!selectedPlace) return;

                  for (const k of CATEGORIES) {
                    if (!myRatings[k] || myRatings[k] < 1) {
                      Alert.alert("Missing rating", "Please rate every category (1–5).");
                      return;
                    }
                  }

                  await addReview(selectedPlace, myRatings);
                  setRateOpen(false);
                  Alert.alert("Submitted!", "Thanks for the review.");
                }}
              >
                <Text style={styles.primaryBtnText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Route Panel */}
        {isRouting && routeStats && (
          <View style={styles.routeContainer}>
            <View style={styles.routeHeader}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.routeTitle}>To: {selectedPlace?.name}</Text>
                <Text style={styles.routeSubTitle}>
                  {routeStats.duration} ({routeStats.distance})
                </Text>

                {routeStats.rampUsed && (
                  <Text style={styles.rampAlert}>
                    ✓ Using crowd-sourced ramp{routeStats.waypoint ? ` near ${routeStats.waypoint}` : ""}
                  </Text>
                )}
              </View>

              <TouchableOpacity onPress={() => setIsRouting(false)} style={styles.closeRouteButton}>
                <Ionicons name="close-circle" size={30} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.stepsList}>
              {routeSteps.map((step, i) => (
                <View key={i} style={styles.stepItem}>
                  <Text style={styles.stepIndex}>{i + 1}.</Text>
                  <Text style={styles.stepText}>{step.instruction}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <StatusBar style="auto" />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  map: { width: "100%", height: "100%" },

  safeArea: {
    position: "absolute",
    top: 0,
    width: "100%",
    zIndex: 1,
    alignItems: "center",
  },
  searchContainer: {
    flexDirection: "row",
    width: "90%",
    marginTop: Platform.OS === "android" ? 40 : 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    backgroundColor: "white",
    borderRadius: 8,
    alignItems: "center",
    paddingRight: 0,
  },
  input: { flex: 1, padding: 12, fontSize: 16 },
  filterButton: { padding: 10 },
  button: {
    backgroundColor: "#007AFF",
    padding: 12,
    justifyContent: "center",
    minWidth: 80,
    alignItems: "center",
    height: "100%",
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  buttonText: { color: "white", fontWeight: "bold", fontSize: 16 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "60%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold" },
  filterOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  filterText: { fontSize: 16 },
  applyButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    alignItems: "center",
  },
  applyButtonText: { color: "white", fontWeight: "bold", fontSize: 16 },

  calloutContainer: {
    backgroundColor: "white",
    padding: 10,
    borderRadius: 8,
    width: 250,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    marginBottom: 5,
  },
  calloutTitle: { fontWeight: "bold", fontSize: 16, marginBottom: 4 },
  calloutAddress: { fontSize: 12, color: "#666", marginBottom: 8 },
  calloutButton: {
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  calloutButtonText: { color: "white", fontWeight: "bold", fontSize: 12 },

  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    height: "70%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  sheetSub: { marginTop: 4, fontSize: 12, color: "#666" },

  primaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#007AFF",
  },
  primaryBtnText: { color: "white", fontWeight: "bold", fontSize: 16 },

  categoryRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  categoryLabel: {
    fontSize: 14,
    marginBottom: 6,
    color: "#333",
    fontWeight: "600",
  },
  rateRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rateLabel: {
    fontSize: 14,
    marginBottom: 8,
    color: "#333",
    fontWeight: "600",
  },

  routeContainer: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    height: "35%",
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 10,
    zIndex: 2,
  },
  routeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 10,
  },
  routeTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  routeSubTitle: { fontSize: 14, color: "#666", marginTop: 2 },
  rampAlert: { color: "#28a745", fontWeight: "bold", marginTop: 6, fontSize: 13 },
  closeRouteButton: { padding: 5 },
  stepsList: { flex: 1 },
  stepItem: { flexDirection: "row", marginBottom: 12, paddingRight: 10 },
  stepIndex: { fontWeight: "bold", marginRight: 8, color: "#007AFF", minWidth: 20 },
  stepText: { fontSize: 14, color: "#333", flex: 1, lineHeight: 20 },

  fabContainer: {
    position: "absolute",
    right: 16,
    bottom: 24,
    zIndex: 10,
  },
  fab: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  fabText: {
    color: "white",
    fontWeight: "bold",
    marginLeft: 8,
  },
});