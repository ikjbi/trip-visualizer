import React, { useState, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, Marker, Polyline, InfoWindow } from '@react-google-maps/api';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { db, auth, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import './App.css';

// Default center ofVietnam
const defaultCenter = { lat: 16.1667, lng: 107.8333 };

function App() {
  const [trips, setTrips] = useState([]);
  const [currentTripId, setCurrentTripId] = useState(null);
  const [activeMarker, setActiveMarker] = useState(null);
  const [newTripName, setNewTripName] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationCoords, setNewLocationCoords] = useState('');
  const [newLocationNotes, setNewLocationNotes] = useState('');
  const [newLocationDays, setNewLocationDays] = useState(1);
  const [mapCenter, setMapCenter] = useState(defaultCenter);
  const [directionsService, setDirectionsService] = useState(null);
  const [durations, setDurations] = useState([]);
  const [mapZoom, setMapZoom] = useState(6);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(new Date());
  const [editingLocation, setEditingLocation] = useState(null);
  const [tripDates, setTripDates] = useState([]);

  // Load Google Maps API
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
    libraries: ['places', 'geometry']
  });

  // Track authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Load trips from Firestore when user is authenticated
  useEffect(() => {
    if (!user) {
      // If not logged in, try to load from localStorage as fallback
      const savedTrips = localStorage.getItem('vietnamTrips');
      if (savedTrips) {
        const parsedTrips = JSON.parse(savedTrips);
        setTrips(parsedTrips);
        
        if (parsedTrips.length > 0) {
          setCurrentTripId(parsedTrips[0].id);
        }
      }
      return;
    }

    const fetchTrips = async () => {
      try {
        const tripsQuery = query(collection(db, "trips"), where("userId", "==", user.uid));
        const querySnapshot = await getDocs(tripsQuery);
        
        const fetchedTrips = [];
        querySnapshot.forEach((doc) => {
          fetchedTrips.push({
            ...doc.data(),
            firestoreId: doc.id
          });
        });
        
        setTrips(fetchedTrips);
        if (fetchedTrips.length > 0) {
          setCurrentTripId(fetchedTrips[0].id);
        }
      } catch (error) {
        console.error("Error fetching trips: ", error);
      }
    };

    fetchTrips();
  }, [user]);

  // Calculate trip dates whenever the current trip changes
  useEffect(() => {
    calculateTripDates();
  }, [currentTripId, trips, durations]);

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
      if (index >= currentTrip.locations.length - 1) {
        // After all calculations, update trip dates
        calculateTripDates();
        return;
      }
      
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

  // Calculate all trip dates based on start date, durations, and stays
  const calculateTripDates = () => {
    if (!currentTripId) return;
    
    const currentTrip = trips.find(trip => trip.id === currentTripId);
    if (!currentTrip || !currentTrip.startDate || currentTrip.locations.length === 0) return;
    
    const dates = [];
    let currentDate = new Date(currentTrip.startDate);
    
    currentTrip.locations.forEach((location, index) => {
      // Arrival date for this location
      const arrivalDate = new Date(currentDate);
      
      // Stay duration (in days)
      const stayDurationDays = location.days || 1;
      
      // Calculate departure date
      const departureDate = new Date(arrivalDate);
      departureDate.setDate(departureDate.getDate() + stayDurationDays);
      
      // Add to our dates array
      dates.push({
        locationId: location.id,
        arrival: arrivalDate,
        departure: departureDate,
        stayDays: stayDurationDays
      });
      
      // Calculate arrival at next location by adding travel time
      if (index < durations.length && durations[index]) {
        // Add travel time (convert seconds to milliseconds)
        const travelTimeMs = durations[index].value * 1000;
        currentDate = new Date(departureDate.getTime() + travelTimeMs);
      } else {
        // If no duration info, just add a day
        currentDate = new Date(departureDate);
      }
    });
    
    setTripDates(dates);
  };

  // Handle login
  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await logOut();
      // Clear user data
      setTrips([]);
      setCurrentTripId(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Create a new trip
  const createTrip = async () => {
    if (!newTripName.trim()) {
      alert('Please enter a trip name');
      return;
    }

    const newTrip = {
      id: Date.now().toString(), // Simple unique ID
      name: newTripName,
      startDate: startDate.toISOString(),
      locations: [],
      userId: user ? user.uid : 'local'
    };

    if (user) {
      // Save to Firestore
      try {
        const docRef = await addDoc(collection(db, "trips"), newTrip);
        newTrip.firestoreId = docRef.id;
        setTrips([...trips, newTrip]);
        setCurrentTripId(newTrip.id);
      } catch (error) {
        console.error("Error adding trip: ", error);
        alert("Failed to save trip to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      const updatedTrips = [...trips, newTrip];
      setTrips(updatedTrips);
      setCurrentTripId(newTrip.id);
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }
    
    setNewTripName('');
  };

  // Add a new location to the current trip
  const addLocation = async () => {
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
      notes: newLocationNotes,
      days: parseInt(newLocationDays) || 1
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

    const currentTrip = updatedTrips.find(trip => trip.id === currentTripId);

    if (user && currentTrip.firestoreId) {
      // Update in Firestore
      try {
        await updateDoc(doc(db, "trips", currentTrip.firestoreId), {
          locations: currentTrip.locations
        });
      } catch (error) {
        console.error("Error updating trip: ", error);
        alert("Failed to save changes to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }

    setTrips(updatedTrips);
    setNewLocationName('');
    setNewLocationCoords('');
    setNewLocationNotes('');
    setNewLocationDays(1);
    
    // Center map on the new location
    setMapCenter({ lat, lng });
    setMapZoom(12); // Zoom in when adding a new location
    
    // Recalculate trip dates
    calculateTripDates();
  };

  // Remove a location from the current trip
  const removeLocation = async (locationId) => {
    const currentTrip = trips.find(trip => trip.id === currentTripId);
    if (!currentTrip) return;

    const updatedLocations = currentTrip.locations.filter(loc => loc.id !== locationId);
    
    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          locations: updatedLocations
        };
      }
      return trip;
    });

    if (user && currentTrip.firestoreId) {
      // Update in Firestore
      try {
        await updateDoc(doc(db, "trips", currentTrip.firestoreId), {
          locations: updatedLocations
        });
      } catch (error) {
        console.error("Error updating trip: ", error);
        alert("Failed to save changes to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }

    setTrips(updatedTrips);
    setActiveMarker(null);
    
    // Recalculate trip dates
    calculateTripDates();
  };

  // Start editing a location
  const startEditLocation = (location) => {
    setEditingLocation(location);
    setNewLocationName(location.name);
    setNewLocationCoords(`${location.lat}, ${location.lng}`);
    setNewLocationNotes(location.notes || '');
    setNewLocationDays(location.days || 1);
  };

  // Save edited location
  const saveEditedLocation = async () => {
    if (!editingLocation) return;

    // Validate inputs
    if (!newLocationName.trim() || !newLocationCoords.trim()) {
      alert('Please enter both a location name and coordinates');
      return;
    }

    // Parse coordinates
    const coordsArray = newLocationCoords.split(',').map(coord => coord.trim());
    if (coordsArray.length !== 2 || isNaN(parseFloat(coordsArray[0])) || isNaN(parseFloat(coordsArray[1]))) {
      alert('Please enter valid coordinates in the format "latitude, longitude"');
      return;
    }

    const lat = parseFloat(coordsArray[0]);
    const lng = parseFloat(coordsArray[1]);

    const currentTrip = trips.find(trip => trip.id === currentTripId);
    if (!currentTrip) return;

    const updatedLocations = currentTrip.locations.map(loc => {
      if (loc.id === editingLocation.id) {
        return {
          ...loc,
          name: newLocationName,
          lat,
          lng,
          notes: newLocationNotes,
          days: parseInt(newLocationDays) || 1
        };
      }
      return loc;
    });

    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          locations: updatedLocations
        };
      }
      return trip;
    });

    if (user && currentTrip.firestoreId) {
      // Update in Firestore
      try {
        await updateDoc(doc(db, "trips", currentTrip.firestoreId), {
          locations: updatedLocations
        });
      } catch (error) {
        console.error("Error updating trip: ", error);
        alert("Failed to save changes to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }

    setTrips(updatedTrips);
    setEditingLocation(null);
    setNewLocationName('');
    setNewLocationCoords('');
    setNewLocationNotes('');
    setNewLocationDays(1);
    
    // Recalculate trip dates
    calculateTripDates();
  };

  // Cancel editing
  const cancelEditLocation = () => {
    setEditingLocation(null);
    setNewLocationName('');
    setNewLocationCoords('');
    setNewLocationNotes('');
    setNewLocationDays(1);
  };

  // Move a location up in the order
  const moveLocationUp = async (index) => {
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

    if (user && currentTrip.firestoreId) {
      // Update in Firestore
      try {
        await updateDoc(doc(db, "trips", currentTrip.firestoreId), {
          locations: newLocations
        });
      } catch (error) {
        console.error("Error updating trip: ", error);
        alert("Failed to save changes to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }

    setTrips(updatedTrips);
  };

  // Move a location down in the order
  const moveLocationDown = async (index) => {
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

    if (user && currentTrip.firestoreId) {
      // Update in Firestore
      try {
        await updateDoc(doc(db, "trips", currentTrip.firestoreId), {
          locations: newLocations
        });
      } catch (error) {
        console.error("Error updating trip: ", error);
        alert("Failed to save changes to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }

    setTrips(updatedTrips);
  };

  // Update trip start date
  const updateTripStartDate = async (date) => {
    setStartDate(date);
    
    if (!currentTripId) return;
    
    const updatedTrips = trips.map(trip => {
      if (trip.id === currentTripId) {
        return {
          ...trip,
          startDate: date.toISOString()
        };
      }
      return trip;
    });
    
    const currentTrip = updatedTrips.find(trip => trip.id === currentTripId);
    
    if (user && currentTrip.firestoreId) {
      // Update in Firestore
      try {
        await updateDoc(doc(db, "trips", currentTrip.firestoreId), {
          startDate: date.toISOString()
        });
      } catch (error) {
        console.error("Error updating trip: ", error);
        alert("Failed to save changes to cloud. Please try again.");
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }
    
    setTrips(updatedTrips);
    
    // Recalculate trip dates
    calculateTripDates();
  };

  // Delete the current trip
  const deleteTrip = async () => {
    if (!currentTripId) return;
    
    if (!window.confirm('Are you sure you want to delete this trip?')) {
      return;
    }

    const tripToDelete = trips.find(trip => trip.id === currentTripId);
    const updatedTrips = trips.filter(trip => trip.id !== currentTripId);
    
    if (user && tripToDelete.firestoreId) {
      // Delete from Firestore
      try {
        await deleteDoc(doc(db, "trips", tripToDelete.firestoreId));
      } catch (error) {
        console.error("Error deleting trip: ", error);
        alert("Failed to delete trip from cloud. Please try again.");
      }
    } else {
      // Update localStorage
      localStorage.setItem('vietnamTrips', JSON.stringify(updatedTrips));
    }
    
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

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Calculate total trip duration
  const calculateTotalDuration = () => {
    if (!tripDates.length) return '0 days';
    
    const firstArrival = tripDates[0].arrival;
    const lastDeparture = tripDates[tripDates.length - 1].departure;
    
    const diffTime = Math.abs(lastDeparture - firstArrival);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return `${diffDays} days`;
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Trip Visualizer</h1>
        <div className="auth-buttons">
          {user ? (
            <div className="user-info">
              <span>Welcome, {user.displayName || user.email}</span>
              <button onClick={handleLogout}>Logout</button>
            </div>
          ) : (
            <button onClick={handleLogin}>Login with Google</button>
          )}
        </div>
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
                <div className="date-picker-container">
                  <label>Start Date:</label>
                  <DatePicker
                    selected={startDate}
                    onChange={date => setStartDate(date)}
                    dateFormat="MMMM d, yyyy"
                    className="date-picker"
                  />
                </div>
                <button onClick={createTrip}>Create Trip</button>
              </div>
            </div>

            {currentTripId && (
              <div className="trip-settings">
                <h3>Trip Settings</h3>
                <div className="input-group">
                  <label>Trip Start Date:</label>
                  <DatePicker
                    selected={currentTrip.startDate ? new Date(currentTrip.startDate) : new Date()}
                    onChange={date => updateTripStartDate(date)}
                    dateFormat="MMMM d, yyyy"
                    className="date-picker"
                  />
                </div>
                <div className="trip-summary">
                  <p><strong>Total Duration:</strong> {calculateTotalDuration()}</p>
                  {currentTrip.startDate && (
                    <p>
                      <strong>Date Range:</strong> {formatDate(currentTrip.startDate)} - 
                      {tripDates.length > 0 ? formatDate(tripDates[tripDates.length - 1].departure) : 'TBD'}
                    </p>
                  )}
                </div>
                <button className="delete-trip-btn" onClick={deleteTrip}>Delete Current Trip</button>
              </div>
            )}
          </div>

          {currentTripId && !editingLocation && (
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
                <label>Days at Location:</label>
                <input
                  type="number"
                  min="1"
                  value={newLocationDays}
                  onChange={(e) => setNewLocationDays(e.target.value)}
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
          
          {editingLocation && (
            <div className="location-management">
              <h2>Edit Location</h2>
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
                <label>Days at Location:</label>
                <input
                  type="number"
                  min="1"
                  value={newLocationDays}
                  onChange={(e) => setNewLocationDays(e.target.value)}
                />
              </div>
              <div className="input-group">
                <textarea
                  placeholder="Notes (optional)"
                  value={newLocationNotes}
                  onChange={(e) => setNewLocationNotes(e.target.value)}
                />
              </div>
              <div className="button-group">
                <button onClick={saveEditedLocation}>Save Changes</button>
                <button className="cancel-btn" onClick={cancelEditLocation}>Cancel</button>
              </div>
            </div>
          )}

          {currentTripId && currentTrip?.locations.length > 0 && (
            <div className="itinerary">
              <h2>Itinerary</h2>
              <button className="reset-view-btn" onClick={resetMapView}>Reset Map View</button>
              <ol className="location-list">
                {currentTrip.locations.map((location, index) => {
                  const locationDates = tripDates.find(date => date.locationId === location.id);
                  
                  return (
                    <li key={location.id} className="location-item">
                      <div className="location-header">
                        <span className="location-name" onClick={() => centerOnLocation(location.lat, location.lng)}>
                          {location.name}
                        </span>
                        <div className="location-actions">
                          <button onClick={() => startEditLocation(location)}>✎</button>
                          <button onClick={() => moveLocationUp(index)} disabled={index === 0}>↑</button>
                          <button onClick={() => moveLocationDown(index)} disabled={index === currentTrip.locations.length - 1}>↓</button>
                          <button onClick={() => removeLocation(location.id)}>✕</button>
                        </div>
                      </div>
                      
                      {locationDates && (
                        <div className="location-dates">
                          <div><strong>Arrival:</strong> {formatDate(locationDates.arrival)}</div>
                          <div><strong>Departure:</strong> {formatDate(locationDates.departure)}</div>
                          <div><strong>Stay:</strong> {locationDates.stayDays} day{locationDates.stayDays !== 1 ? 's' : ''}</div>
                        </div>
                      )}
                      
                      {location.notes && <p className="location-notes">{location.notes}</p>}
                      
                      {index < durations.length && durations[index] && (
                        <div className="travel-duration">
                          Travel to next: {durations[index].text}
                        </div>
                      )}
                    </li>
                  );
                })}
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
                    {tripDates.length > 0 && (
                      <p>
                        <strong>Dates:</strong> {
                          formatDate(tripDates.find(date => date.locationId === activeMarker)?.arrival)
                        } - {
                          formatDate(tripDates.find(date => date.locationId === activeMarker)?.departure)
                        }
                      </p>
                    )}
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
