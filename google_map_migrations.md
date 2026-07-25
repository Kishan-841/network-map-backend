# Google Maps Migration Guide

Project: ISP Coverage System

---

# Overview

This project initially used:

- Leaflet
- OpenStreetMap
- Nominatim

After testing in real-world conditions, OpenStreetMap was found to have inconsistent building coverage and search accuracy, especially for apartment complexes and commercial buildings.

Since this application depends heavily on accurate building identification, Google Maps Platform has been selected as the permanent mapping provider.

Google Maps should be used ONLY during building creation.

After a building is saved, all future reads must come from our PostgreSQL database.

---

# Why Google Maps

Advantages

✓ Better building coverage

✓ Better search accuracy

✓ Better apartment recognition

✓ Reliable Place IDs

✓ Better support in India

✓ Long-term stability

---

# Architecture

Surveyor

↓

Browser GPS

↓

Google Places Autocomplete

↓

Google Place Details

↓

Save Building

↓

PostgreSQL

↓

Every Future Read

↓

Database Only

Google is never queried again for existing buildings.

---

# APIs Used

Only enable these APIs.

1. Maps JavaScript API

Purpose

Displays interactive map.

Used For

- Map
- Marker
- Zoom
- User location
- Building marker

---

2. Places API (New)

Purpose

Search buildings.

Used For

Autocomplete

Example

User types

Galaxy

↓

Google returns

Galaxy Heights

Galaxy Residency

Galaxy One

↓

User selects one

↓

Retrieve details

---

# APIs NOT Required

Do NOT use

- Geocoding API
- Directions API
- Distance Matrix API
- Roads API
- Street View API
- Geolocation API

Browser Geolocation is sufficient.

---

# Browser Geolocation

Always obtain user's location from

navigator.geolocation

Reason

- Free
- Accurate enough
- Doesn't consume Google quota

Flow

User opens Add Building

↓

Browser requests permission

↓

Latitude

Longitude

Accuracy

↓

Center map

---

# Building Creation Flow

1.

Open Add Building

↓

2.

Get GPS

↓

3.

Center Google Map

↓

4.

User searches building

↓

5.

Autocomplete Suggestions

↓

6.

User selects building

↓

7.

Fetch Place Details

↓

8.

Populate

- Building Name
- Address
- Latitude
- Longitude
- Place ID

↓

9.

Fill internal fields

Zone

Floors

Wings

Home Pass

Remarks

↓

10.

Upload documents

↓

11.

Save

---

# Data Stored

Store everything returned by Google.

Example

place_id

building_name

formatted_address

latitude

longitude

plus_code (optional)

Never call Google again for these values.

---

# Duplicate Prevention

Before Save

Search our database

Radius

50-100 meters

If duplicate found

Display

Building already exists.

Allow

Open Existing Building

OR

Continue Anyway

---

# Database is Source of Truth

Once saved

Never call Google again.

Map

↓

Buildings

↓

Reports

↓

Dashboard

↓

Analytics

↓

All use PostgreSQL.

---

# Search Strategy

Google should only be used during

Building Creation

Future building search should query

Our Database

Not Google

This reduces cost dramatically.

---

# Marker Colors

Green

Feasible

Orange

Permission Pending

Blue

Survey Pending

Red

Rejected

Gray

Unknown

---

# Map Features

Required

✓ Locate Me

✓ Zoom

✓ Search

✓ Current Marker

✓ Existing Building Marker

Future

Cluster

Heat Map

Fiber Routes

Cabinets

Poles

---

# Cost Optimization

Never use

Nearby Search

Never use

Geocoding

Never use

Directions

Never request Place Details twice.

Cache everything.

---

# Performance

Google

↓

One API Call

↓

Save

↓

Done

Everything else

↓

Database

This keeps API costs extremely low.

---

# Future Scalability

This architecture supports

Buildings

Fiber Routes

Poles

Cabinets

POP

OLT

without changing the mapping architecture.