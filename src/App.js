import React, { useState, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, Marker, Polyline, InfoWindow } from '@react-google-maps/api';
import './App.css';

// Default center of Vietnam
const defaultCenter = { lat: 16.1667, lng: 107.8333 };

function App() {
  const [trips, setTrips] = useState([]);
  const [currentTripId, setCurrentTripId] = useState(null);
  const [activeMarker, setActiveMarker] = useState(null);
  const [newTripName, setNewTripName] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationCoords, setNewLocationCoords] = useState('');
  const [newLocationNotes, setNewLocationNotes] = useState('');
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [directionsService, setDirectionsService] = useState(null);
  const [durations, setDurations] = useState([]);
  const [mapZoom, setMapZoom] = useState(6);

  // Load Google Maps API
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: AIzaSyAMpdzmaT3TqP57u_tv4lEJmVrHylOtlHU, // You'll need to replace this with your API key
    libraries: ['places', 'geometry']
  });

  // Load trips from localStorage on component mount
  useEffect(() => {
    const savedTrips = localStorage.getItem('vietnamTrips');
    if (savedTrips) {
      const parsedTrips = JSON.parse(savedTrips);
      setTrips(parsedTrips);
      
      // Set current trip to the first one if it exists
      if (parsedTrips.length > 0) {
        setCurrentTripId(parsedTrips[0].id);
      }
    }
  }, []);

  // Save trips to localStorage whenever trips change
  useEffect(() => {
    localStorage.setItem('vietnamTrips', JSON.stringify(trips));
  }, [trips]);

  // Initialize DirectionsService once map is loaded
  const onMapLoad = (map) => {
    if (window.google) {
      setDirectionsService(new window.google.maps.DirectionsService());
    }
  };

  // Calculate durations between destinations when current trip changes
  useEffect(() => {
    if (!directionsService || !currentTripId) return;
    
    const currentTrip = trips.find(trip => trip.id === currentTripId);
    if (!currentTrip || currentTrip.locations.length < 2) {
      setDurations([]);
      return;
    }

    const newDurations = [];
    
    // Create a queue of requests to avoid rate limits
    const calculateNextDuration = (index) => {
      if (index >= currentTrip.locations.length - 1) return;
      
      const origin = currentTrip.locations[index];
      const destination = currentTrip.locations[index + 1];
      
      directionsService.route(
        {
          origin: { lat: parseFloat(origin.lat), lng: parseFloat(origin.lng) },
          destination: { lat: parseFloat(destination.lat), lng: parseFloat(destination.lng) },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            newDurations[index] = {
              text: result.routes[0].legs[0].duration.text,
              value: result.routes[0].legs[0].duration.value,
            };
            setDurations([...newDurations]);
            
            // Calculate next duration after a small delay to avoid hitting rate limits
            setTimeout(() => calculateNextDuration(index + 1), 300);
          } else {
            newDurations[index] = { text: 'Unknown', value: 0 };
            setDurations([...newDurations]);
            setTimeout(() => calculateNextDuration(index + 1), 300);
          }
        }
      );
    };
    
    // Start the calculation queue
    calculateNextDuration(0);
  }, [currentTripId, trips, directionsService]);

  // Create a new trip
  const createTrip = () => {
    if (!newTripName.trim()) {
      alert('Please enter a trip name');
      return;
    }

    const newTrip = {
      id: Date.now().toString(), // Simple unique ID
      name: newTripName,
      locations: []
    };

    setTrips([...trips, newTrip]);
    setCurrentTripId(newTrip.id);
    setNewTripName('');
  };

  // Add a new location to the current trip
  const addLocation = () => {
    if (!currentTripId) {
      alert('Please create or select a trip first');
      return;
    }

    if (!newLocationName.trim() || !newLocationCoords.trim()) {
      alert('Please enter both a location name and coordinates');
      return;
    }

    // Parse coordinates from string (e.g. "21.0278, 105.8342")
    const coordsArray = newLocationCoords.split(',').map(coord => coord.trim());
    if (coordsArray.length !== 2 || isNaN(parseFloat(coordsArray[0])) || isNaN(parseFloat(coordsArray[1]))) {
      alert('Please enter valid coordinates in the format "latitude, longitude"');
      return;
    }

    const lat = parseFloat(coordsArray[0]);
    const lng = parseFloat(coordsArray[1]);

    const newLocation = {
      id: Date.now().toString(),
      name: newLocationName,
      lat,
      lng,
      notes: newLocationNotes
    };

    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          locations: [...trip.locations, newLocation]
        };
      }
      return trip;
    });

    setTrips(updatedTrips);
    setNewLocationName('');
    setNewLocationCoords('');
    setNewLocationNotes('');
    
    // Center map on the new location
    setMapCenter({ lat, lng });
    setMapZoom(12); // Zoom in when adding a new location
  };

  // Remove a location from the current trip
  const removeLocation = (locationId) => {
    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          locations: trip.locations.filter(loc => loc.id !== locationId)
        };
      }
      return trip;
    });

    setTrips(updatedTrips);
    setActiveMarker(null);
  };

  // Move a location up in the order
  const moveLocationUp = (index) => {
    if (index === 0) return;

    const currentTrip = trips.find(trip => trip.id === currentTripId);
    if (!currentTrip) return;

    const newLocations = [...currentTrip.locations];
    [newLocations[index - 1], newLocations[index]] = [newLocations[index], newLocations[index - 1]];

    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          locations: newLocations
        };
      }
      return trip;
    });

    setTrips(updatedTrips);
  };

  // Move a location down in the order
  const moveLocationDown = (index) => {
    const currentTrip = trips.find(trip => trip.id === currentTripId);
    if (!currentTrip || index === currentTrip.locations.length - 1) return;

    const newLocations = [...currentTrip.locations];
    [newLocations[index], newLocations[index + 1]] = [newLocations[index + 1], newLocations[index]];

    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          locations: newLocations
        };
      }
      return trip;
    });

    setTrips(updatedTrips);
  };

  // Delete the current trip
  const deleteTrip = () => {
    if (!currentTripId) return;
    
    if (!window.confirm('Are you sure you want to delete this trip?')) {
      return;
    }

    const updatedTrips = trips.filter(trip => trip.id !== currentTripId);
    setTrips(updatedTrips);
    
    if (updatedTrips.length > 0) {
      setCurrentTripId(updatedTrips[0].id);
    } else {
      setCurrentTripId(null);
    }
  };

  // Get current trip object
  const currentTrip = trips.find(trip => trip.id === currentTripId);

  // Reset map view to see all of Vietnam
  const resetMapView = () => {
    setMapCenter(defaultCenter);
    setMapZoom(6);
  };

  // Center map on a specific location
  const centerOnLocation = (lat, lng) => {
    setMapCenter({ lat, lng });
    setMapZoom(12);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Vietnam Trip Visualizer</h1>
      </header>

      <div className="app-container">
        <div className="sidebar">
          <div className="trip-management">
            <h2>Trip Management</h2>
            <div className="trip-selector">
              <label htmlFor="trip-select">Select Trip:</label>
              <select 
                id="trip-select" 
                value={currentTripId || ''} 
                onChange={(e) => setCurrentTripId(e.target.value)}
              >
                <option value="">-- Select a Trip --</option>
                {trips.map(trip => (
                  <option key={trip.id} value={trip.id}>{trip.name}</option>
                ))}
              </select>
            </div>

            <div className="trip-creator">
              <h3>Create New Trip</h3>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Trip Name"
                  value={newTripName}
                  onChange={(e) => setNewTripName(e.target.value)}
                />
                <button onClick={createTrip}>Create Trip</button>
              </div>
            </div>

            {currentTripId && (
              <button className="delete-trip-btn" onClick={deleteTrip}>Delete Current Trip</button>
            )}
          </div>

          {currentTripId && (
            <div className="location-management">
              <h2>Add Location to "{currentTrip?.name}"</h2>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Location Name"
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                />
              </div>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Coordinates (lat, lng)"
                  value={newLocationCoords}
                  onChange={(e) => setNewLocationCoords(e.target.value)}
                />
              </div>
              <div className="input-group">
                <textarea
                  placeholder="Notes (optional)"
                  value={newLocationNotes}
                  onChange={(e) => setNewLocationNotes(e.target.value)}
                />
              </div>
              <button onClick={addLocation}>Add Location</button>
              <p className="coordinates-tip">
                Tip: To get coordinates from Google Maps, right-click on a location and select "What's here?". 
                The coordinates will appear in the info card at the bottom of the screen.
              </p>
            </div>
          )}

          {currentTripId && currentTrip?.locations.length > 0 && (
            <div className="itinerary">
              <h2>Itinerary</h2>
              <button className="reset-view-btn" onClick={resetMapView}>Reset Map View</button>
              <ol className="location-list">
                {currentTrip.locations.map((location, index) => (
                  <li key={location.id} className="location-item">
                    <div className="location-header">
                      <span className="location-name" onClick={() => centerOnLocation(location.lat, location.lng)}>
                        {location.name}
                      </span>
                      <div className="location-actions">
                        <button onClick={() => moveLocationUp(index)} disabled={index === 0}>↑</button>
                        <button onClick={() => moveLocationDown(index)} disabled={index === currentTrip.locations.length - 1}>↓</button>
                        <button onClick={() => removeLocation(location.id)}>✕</button>
                      </div>
                    </div>
                    {location.notes && <p className="location-notes">{location.notes}</p>}
                    {index < durations.length && durations[index] && (
                      <div className="travel-duration">
                        Travel to next: {durations[index].text}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="map-container">
          {isLoaded ? (
            <GoogleMap
              mapContainerClassName="map"
              center={mapCenter}
              zoom={mapZoom}
              onLoad={onMapLoad}
            >
              {currentTrip?.locations.map((location, index) => (
                <Marker
                  key={location.id}
                  position={{ lat: location.lat, lng: location.lng }}
                  label={(index + 1).toString()}
                  onClick={() => setActiveMarker(location.id)}
                />
              ))}

              {activeMarker && (
                <InfoWindow
                  position={{
                    lat: currentTrip.locations.find(loc => loc.id === activeMarker).lat,
                    lng: currentTrip.locations.find(loc => loc.id === activeMarker).lng
                  }}
                  onCloseClick={() => setActiveMarker(null)}
                >
                  <div>
                    <h3>{currentTrip.locations.find(loc => loc.id === activeMarker).name}</h3>
                    <p>{currentTrip.locations.find(loc => loc.id === activeMarker).notes}</p>
                  </div>
                </InfoWindow>
              )}

              {currentTrip?.locations.length > 1 && (
                <Polyline
                  path={currentTrip.locations.map(loc => ({ lat: loc.lat, lng: loc.lng }))}
                  options={{
                    strokeColor: '#FF0000',
                    strokeOpacity: 0.8,
                    strokeWeight: 3,
                  }}
                />
              )}
            </GoogleMap>
          ) : (
            <div className="loading-map">Loading map...</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
