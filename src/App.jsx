import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import L from 'leaflet';
import { supabase } from './supabaseClient';
import Auth from './Auth';

/**
 * SQL for Database Update:
 * 
 * ALTER TABLE locations 
 * ADD COLUMN device_name TEXT DEFAULT 'My AirTag',
 * ADD COLUMN device_emoji TEXT DEFAULT '🏷️';
 */

function App() {
  const [locations, setLocations] = useState([]);
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [datetime, setDatetime] = useState('');
  const [session, setSession] = useState(null);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [isTestMode, setIsTestMode] = useState(() => {
    return localStorage.getItem('isTestMode') === 'true';
  });
  const [editAddress, setEditAddress] = useState('');
  const [editDatetime, setEditDatetime] = useState('');
  const [loading, setLoading] = useState(true);

  // Multi-device state
  const [selectedDeviceId, setSelectedDeviceId] = useState('all');
  const [deviceName, setDeviceName] = useState('My AirTag');
  const [deviceEmoji, setDeviceEmoji] = useState('🏷️');

  // Load locations from Supabase on mount
  useEffect(() => {
    fetchLocations();
    updateCurrentDatetime();
  }, [isTestMode]);

  useEffect(() => {
    localStorage.setItem('isTestMode', isTestMode);
  }, [isTestMode]);

  // Auth session listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Real-time subscription
  useEffect(() => {
    if (isTestMode) return;

    const channel = supabase
      .channel('realtime_locations')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'locations'
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setLocations(prev => {
            // Check if record already exists to avoid duplicates
            if (prev.some(loc => loc.id === payload.new.id)) return prev;
            return [...prev, payload.new].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
          });
        } else if (payload.eventType === 'UPDATE') {
          setLocations(prev => prev.map(loc => loc.id === payload.new.id ? payload.new : loc));
        } else if (payload.eventType === 'DELETE') {
          setLocations(prev => prev.filter(loc => loc.id === payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isTestMode]);

  const fetchLocations = async () => {
    setLoading(true);
    if (isTestMode) {
      const testData = JSON.parse(localStorage.getItem('test_locations') || '[]');
      setLocations(testData);
    } else {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('datetime', { ascending: true });

      if (error) {
        console.error('Error fetching locations:', error);
      } else {
        setLocations(data || []);
      }
    }
    setLoading(false);
  };

  const updateCurrentDatetime = () => {
    const now = new Date();
    const options = {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
    const get = (type) => parts.find(p => p.type === type)?.value || '';
    const formatted = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
    setDatetime(formatted);
  };

  const torontoToISO = (localStr) => {
    if (!localStr) return new Date().toISOString();
    try {
      const date = new Date(localStr);
      const torontoDateStr = date.toLocaleString('en-US', { timeZone: 'America/Toronto', hour12: false });
      const matches = torontoDateStr.match(/\d+/g);
      if (!matches) return date.toISOString();
      const [m, d, y, h, min, s] = matches;
      const torontoInBrowserLocal = new Date(y, m - 1, d, h, min, s);
      const diff = date - torontoInBrowserLocal;
      return new Date(date.getTime() + diff).toISOString();
    } catch (e) {
      console.error('Timezone conversion error:', e);
      return new Date(localStr).toISOString();
    }
  };

  const formatTorontoTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      timeZone: 'America/Toronto',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatTimeOnly = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const currentMapCenter = useMemo(() => {
    if (locations.length > 0) {
      const last = locations[locations.length - 1];
      return { lat: last.lat, lon: last.lng };
    }
    return { lat: 43.6532, lon: -79.3832 }; // Default Toronto
  }, [locations]);

  const geocodeAddress = async (addr) => {
    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(addr)}&lat=${currentMapCenter.lat}&lon=${currentMapCenter.lon}&limit=1`
      );
      const data = await response.json();
      if (data?.features?.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates;
        return { lat, lng };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  const handleAddressChange = async (value) => {
    setAddress(value);
    if (value.length > 2) {
      try {
        const response = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(value)}&lat=${currentMapCenter.lat}&lon=${currentMapCenter.lon}&limit=5`
        );
        const data = await response.json();
        const suggestions = (data.features || []).map(f => ({
          display_name: [f.properties.name, f.properties.street, f.properties.city, f.properties.state].filter(Boolean).join(', '),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0]
        }));
        setAddressSuggestions(suggestions);
      } catch (error) {
        console.error('Autocomplete error:', error);
      }
    } else {
      setAddressSuggestions([]);
    }
  };

  const selectSuggestion = (suggestion) => {
    setAddress(suggestion.display_name);
    setLatitude(suggestion.lat);
    setLongitude(suggestion.lon);
    setAddressSuggestions([]);
  };

  const handleAddLocation = async () => {
    let coords = null;
    if (latitude && longitude) {
      coords = { lat: parseFloat(latitude), lng: parseFloat(longitude) };
    } else if (address) {
      coords = await geocodeAddress(address);
      if (!coords) {
        alert('Could not find location. Try being more specific.');
        return;
      }
    } else {
      alert('Address or coordinates required.');
      return;
    }

    const finalIsoString = torontoToISO(datetime);
    const newLocation = {
      address: address || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
      lat: coords.lat,
      lng: coords.lng,
      datetime: finalIsoString,
      device_name: deviceName,
      device_emoji: deviceEmoji,
      user_id: session?.user?.id
    };

    if (isTestMode) {
      const testData = JSON.parse(localStorage.getItem('test_locations') || '[]');
      const locationWithId = { ...newLocation, id: Date.now() };
      const updatedData = [...testData, locationWithId];
      localStorage.setItem('test_locations', JSON.stringify(updatedData));
      setLocations(updatedData);
    } else {
      const { data, error } = await supabase.from('locations').insert([newLocation]).select();
      if (error) {
        alert('DB Error: ' + error.message);
        return;
      }
      setLocations([...locations, data[0]]);
    }

    setAddress(''); setLatitude(''); setLongitude(''); setAddressSuggestions([]);
    updateCurrentDatetime();
  };

  const handleDeleteLocation = async (id) => {
    if (isTestMode) {
      const updatedData = locations.filter(loc => loc.id !== id);
      localStorage.setItem('test_locations', JSON.stringify(updatedData));
      setLocations(updatedData);
    } else {
      const { error } = await supabase.from('locations').delete().eq('id', id);
      if (error) return alert('Failed to delete');
      setLocations(locations.filter(loc => loc.id !== id));
    }
  };

  // Unique devices listed in history with stable color assignment
  const deviceConfig = useMemo(() => {
    const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444'];
    const map = new Map();
    let colorIndex = 0;

    // Sort locations by time to get consistent order for color assignment
    const sorted = [...locations].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    sorted.forEach(loc => {
      if (!map.has(loc.device_name)) {
        map.set(loc.device_name, {
          name: loc.device_name,
          emoji: loc.device_emoji || '🏷️',
          color: COLORS[colorIndex % COLORS.length]
        });
        colorIndex++;
      }
    });
    return Array.from(map.values());
  }, [locations]);

  const getDeviceColor = (name) => {
    return deviceConfig.find(d => d.name === name)?.color || '#6366f1';
  };

  const filteredLocations = useMemo(() => {
    return locations.filter(loc => selectedDeviceId === 'all' || loc.device_name === selectedDeviceId);
  }, [locations, selectedDeviceId]);

  const sortedFiltered = useMemo(() => {
    return [...filteredLocations].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  }, [filteredLocations]);

  const mapCenter = useMemo(() => {
    if (sortedFiltered.length > 0) {
      const last = sortedFiltered[sortedFiltered.length - 1];
      return [last.lat, last.lng];
    }
    return [43.6532, -79.3832];
  }, [sortedFiltered]);

  const polylinePositions = sortedFiltered.map(loc => [loc.lat, loc.lng]);

  const createCustomIcon = (emoji, index, color) => {
    return L.divIcon({
      className: 'custom-marker',
      html: `
        <div class="marker-emoji" style="border-color: ${color}">${emoji}</div>
        <div class="marker-number" style="background: ${color}">${index + 1}</div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });
  };

  const MapController = ({ center }) => {
    const map = useMap();
    useEffect(() => {
      if (center) map.flyTo(center, 15);
    }, [center, map]);
    return null;
  };

  if (!session && !isTestMode) {
    return <Auth />;
  }

  return (
    <div className={`app-container ${isTestMode ? 'test-mode-active' : ''}`}>
      <div className="sidebar">
        <div className="header-row">
          <h1>AirTag Tracker</h1>
          <div className="test-mode-toggle">
            <label className="switch">
              <input type="checkbox" checked={isTestMode} onChange={() => setIsTestMode(!isTestMode)} />
              <span className="slider"></span>
            </label>
            <span className="test-mode-label">TEST MODE</span>
          </div>
        </div>

        {isTestMode && <div className="test-mode-banner">🧪 Using LocalStorage Database</div>}

        <div className="user-profile">
          <div className="user-info">
            <span className="user-email">{session?.user?.email}</span>
          </div>
          <button className="btn-logout" onClick={() => supabase.auth.signOut()}>Logout</button>
        </div>

        <div className="form-section">
          <h2><span>➕</span> Add Location</h2>

          <div className="device-row">
            <div className="form-group">
              <label>Device Name</label>
              <input
                list="device-history"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g. Keys"
              />
              <datalist id="device-history">
                {deviceConfig.map(d => <option key={d.name} value={d.name} />)}
              </datalist>
            </div>
            <div className="form-group" style={{ width: '60px' }}>
              <label>Icon</label>
              <input value={deviceEmoji} onChange={(e) => setDeviceEmoji(e.target.value)} style={{ textAlign: 'center' }} />
            </div>
          </div>

          <div className="form-group">
            <label>Address</label>
            <div className="autocomplete-wrapper">
              <input value={address} onChange={(e) => handleAddressChange(e.target.value)} placeholder="Search address..." />
              {addressSuggestions.length > 0 && (
                <div className="autocomplete-dropdown">
                  {addressSuggestions.map((s, i) => (
                    <div key={i} className="autocomplete-item" onClick={() => selectSuggestion(s)}>{s.display_name}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>Date & Time (Toronto)</label>
            <input type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
          </div>

          <button className="btn-primary" onClick={handleAddLocation}>Save Location</button>
        </div>

        <div className="history-section">
          <h2><span>🕒</span> History</h2>

          <div className="device-filters">
            <div
              className={`filter-chip ${selectedDeviceId === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedDeviceId('all')}
            >
              All Devices
            </div>
            {deviceConfig.map(d => (
              <div
                key={d.name}
                className={`filter-chip ${selectedDeviceId === d.name ? 'active' : ''}`}
                onClick={() => setSelectedDeviceId(d.name)}
                style={selectedDeviceId === 'all' || selectedDeviceId === d.name ? { borderLeft: `4px solid ${d.color}` } : {}}
              >
                {d.emoji} {d.name}
              </div>
            ))}
          </div>

          <div className="location-list">
            {sortedFiltered.length === 0 ? (
              <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>No locations found</p>
            ) : (
              [...sortedFiltered].reverse().map((loc, idx) => (
                <div key={loc.id} className="location-item">
                  <div className="device-icon-circle">
                    {loc.device_emoji || '📍'}
                  </div>
                  <div className="location-info">
                    <strong>{loc.address}</strong>
                    <small>{formatTorontoTime(loc.datetime)}</small>
                  </div>
                  <button className="btn-icon" onClick={() => handleDeleteLocation(loc.id)}>✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="map-container">
        {loading ? (
          <div className="map-loading">Loading Tracker...</div>
        ) : (
          <MapContainer center={mapCenter} zoom={13} zoomControl={false}>
            <MapController center={mapCenter} />
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {/* Render paths per device */}
            {deviceConfig.map(dev => {
              if (selectedDeviceId !== 'all' && selectedDeviceId !== dev.name) return null;
              const pathPositions = sortedFiltered
                .filter(loc => loc.device_name === dev.name)
                .map(loc => [loc.lat, loc.lng]);

              return pathPositions.length > 1 ? (
                <Polyline
                  key={`path-${dev.name}`}
                  positions={pathPositions}
                  color={dev.color}
                  weight={4}
                  opacity={0.6}
                  dashArray="10, 10"
                />
              ) : null;
            })}

            {sortedFiltered.map((loc, idx) => (
              <Marker
                key={loc.id}
                position={[loc.lat, loc.lng]}
                icon={createCustomIcon(loc.device_emoji || '📍', idx, getDeviceColor(loc.device_name))}
              >
                <Tooltip direction="top" offset={[0, -40]} permanent opacity={0.9}>
                  <span style={{ fontWeight: 800 }}>{formatTimeOnly(loc.datetime)}</span>
                </Tooltip>
                <Popup>
                  <div style={{ padding: '4px' }}>
                    <strong style={{ fontSize: '1.1rem', color: getDeviceColor(loc.device_name) }}>
                      {loc.device_emoji} {loc.device_name}
                    </strong><br />
                    <small style={{ color: '#64748b' }}>{formatTorontoTime(loc.datetime)}</small><br />
                    <div style={{ marginTop: '4px', fontSize: '0.85rem' }}>{loc.address}</div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}

export default App;
