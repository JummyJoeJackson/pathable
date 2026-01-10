import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, Platform, Alert, Keyboard, ActivityIndicator, Modal, ScrollView, Image } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

// Backend URL
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';

interface Place {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  features: string[];
}

interface RouteStep {
  instruction: string;
  distance: string;
  duration: string;
}

const FILTER_OPTIONS = [
  'Accessible Entrance',
  'Accessible Restroom',
  'Accessible Seating',
  'Accessible Parking',
  'Elevator'
];

export default function App() {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

  // Routing State
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [route, setRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [isRouting, setIsRouting] = useState(false);
  const [routeStats, setRouteStats] = useState<{ distance: string, duration: string, rampUsed: boolean } | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission to access location was denied');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setLocation(location);
    })();
  }, []);

  const searchPlaces = async () => {
    if (!query.trim()) return;
    Keyboard.dismiss();
    setLoading(true);

    // Clear previous route when searching new places
    setRoute([]);
    setRouteSteps([]);
    setIsRouting(false);

    try {
      const response = await fetch(`${API_URL}/api/places?query=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      if (data.error) {
        Alert.alert('Error', data.error);
        return;
      }

      setPlaces(data);

      // If we found places, center map on the first one
      if (data.length > 0) {
        const newRegion = {
          latitude: data[0].lat,
          longitude: data[0].lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        mapRef.current?.animateToRegion(newRegion, 1000);
      }
    } catch (error) {
      console.error('Error fetching places:', error);
      Alert.alert('Error', 'Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  const fetchDirections = async (destination: Place) => {
    if (!location) {
      Alert.alert('Error', 'Waiting for user location...');
      return;
    }

    setLoading(true);
    try {
      const originStr = `${location.coords.latitude},${location.coords.longitude}`;
      const destStr = `${destination.lat},${destination.lng}`; // Using lat/lng which is reliable

      const response = await fetch(`${API_URL}/api/directions?origin=${originStr}&destination=${destStr}`);
      const data = await response.json();

      if (data.error) {
        Alert.alert('Error', data.error);
        return;
      }

      setRoute(data.points);
      setRouteSteps(data.steps);
      setRouteStats({
        distance: data.distance,
        duration: data.duration,
        rampUsed: data.ramp_used
      });
      setIsRouting(true);

      // Zoom to fit route
      mapRef.current?.fitToCoordinates(data.points, {
        edgePadding: { top: 50, right: 50, bottom: 300, left: 50 },
        animated: true,
      });

    } catch (error) {
      console.error('Error fetching directions:', error);
      Alert.alert('Error', 'Failed to fetch directions.');
    } finally {
      setLoading(false);
    }
  };

  const toggleFilter = (filter: string) => {
    if (selectedFilters.includes(filter)) {
      setSelectedFilters(selectedFilters.filter(f => f !== filter));
    } else {
      setSelectedFilters([...selectedFilters, filter]);
    }
  };

  const filteredPlaces = places.filter(place =>
    selectedFilters.every(filter => place.features.includes(filter))
  );

  const getPinColor = (rating: number) => {
    if (rating >= 4) return 'green';
    if (rating >= 2.5) return 'orange';
    return 'red';
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={styles.map}
          // set initial region to Toronto, ON
          initialRegion={{
            latitude: 43.6532,
            longitude: -79.3832,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          provider={PROVIDER_GOOGLE}
          showsUserLocation={true}
          showsMyLocationButton={true}
          onUserLocationChange={(e) => setLocation({ ...location, coords: e.nativeEvent.coordinate } as any)}
        >
          {filteredPlaces.map((place, index) => (
            <Marker
              key={index}
              coordinate={{ latitude: place.lat, longitude: place.lng }}
              title={place.name}
              pinColor={getPinColor(place.rating)}
              onPress={() => setSelectedPlace(place)}
            >
              <Callout tooltip onPress={() => fetchDirections(place)}>
                <View style={styles.calloutContainer}>
                  <View style={styles.calloutHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.calloutTitle}>{place.name}</Text>
                      <Text style={styles.calloutAddress}>{place.address}</Text>
                    </View>
                    {place.features.includes('Elevator') && (
                      <Image
                        source={require('./assets/elevator_icon.png')}
                        style={styles.elevatorIcon}
                      />
                    )}
                  </View>
                  <View style={styles.ratingContainer}>
                    <Text style={styles.ratingLabel}>Access Rating:</Text>
                    <Text style={[styles.ratingValue, { color: getPinColor(place.rating) }]}>
                      {place.rating}/5
                    </Text>
                  </View>
                  {place.features.length > 0 && (
                    <View style={styles.featuresContainer}>
                      {place.features.map((feature, i) => (
                        <Text key={i} style={styles.featureTag}>• {feature}</Text>
                      ))}
                    </View>
                  )}
                  <View style={styles.calloutButton}>
                    <Text style={styles.calloutButtonText}>Tap to Route</Text>
                  </View>
                </View>
              </Callout>
            </Marker>
          ))}

          {isRouting && route.length > 0 && (
            <Polyline
              coordinates={route}
              strokeColor="#007AFF"
              strokeWidth={5}
            />
          )}

        </MapView>

        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.input}
              placeholder="Search (e.g. Walmart, Library)..."
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={searchPlaces}
              returnKeyType="search"
            />
            <TouchableOpacity onPress={() => setFilterVisible(true)} style={styles.filterButton}>
              <Ionicons name="filter" size={24} color={selectedFilters.length > 0 ? "#007AFF" : "#666"} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.button}
              onPress={searchPlaces}
              disabled={loading}
            >
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
          transparent={true}
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
                <Text style={styles.applyButtonText}>Apply Filters ({selectedFilters.length})</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Route Info Panel */}
        {isRouting && routeStats && (
          <View style={styles.routeContainer}>
            <View style={styles.routeHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeTitle}>To: {selectedPlace?.name}</Text>
                <Text style={styles.routeSubTitle}>{routeStats.duration} ({routeStats.distance})</Text>
                {routeStats.rampUsed && (
                  <Text style={styles.rampAlert}>✓ Shortcut via Manual Ramp</Text>
                )}
              </View>
              <View style={styles.headerIcons}>
                {selectedPlace?.features.includes('Elevator') && (
                  <Image
                    source={require('./assets/elevator_icon.png')}
                    style={styles.elevatorIcon}
                  />
                )}
                <TouchableOpacity onPress={() => setIsRouting(false)} style={styles.closeRouteButton}>
                  <Ionicons name="close-circle" size={30} color="#666" />
                </TouchableOpacity>
              </View>
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
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  safeArea: {
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 1,
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    width: '90%',
    marginTop: Platform.OS === 'android' ? 40 : 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    backgroundColor: 'white',
    borderRadius: 8,
    alignItems: 'center',
    paddingRight: 0,
  },
  input: {
    flex: 1,
    padding: 12,
    fontSize: 16,
  },
  filterButton: {
    padding: 10,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 12,
    justifyContent: 'center',
    minWidth: 80,
    alignItems: 'center',
    height: '100%',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterText: {
    fontSize: 16,
  },
  applyButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    alignItems: 'center',
  },
  applyButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  calloutContainer: {
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    width: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    marginBottom: 5, // space for arrow
  },
  calloutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  calloutTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 2,
  },
  elevatorIcon: {
    width: 60,
    height: 60,
    marginLeft: 8,
    resizeMode: 'contain',
  },
  calloutAddress: {
    fontSize: 12,
    color: '#666',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  ratingLabel: {
    fontSize: 14,
    marginRight: 4,
  },
  ratingValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  featuresContainer: {
    marginTop: 4,
    marginBottom: 8,
  },
  featureTag: {
    fontSize: 12,
    color: '#333',
    backgroundColor: '#f0f0f0',
    padding: 2,
    borderRadius: 4,
    marginBottom: 2,
    alignSelf: 'flex-start',
  },
  calloutButton: {
    backgroundColor: '#28a745',
    padding: 8,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 5,
  },
  calloutButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  // Routing Styles
  routeContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: '35%',
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 10,
    zIndex: 2,
  },
  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  routeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  routeSubTitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  rampAlert: {
    color: '#28a745',
    fontWeight: 'bold',
    marginTop: 4,
    fontSize: 14,
  },
  closeRouteButton: {
    padding: 5,
    marginLeft: 5,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepsList: {
    flex: 1,
  },
  stepItem: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingRight: 10,
  },
  stepIndex: {
    fontWeight: 'bold',
    marginRight: 8,
    color: '#007AFF',
    minWidth: 20,
  },
  stepText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
    lineHeight: 20,
  },
});
