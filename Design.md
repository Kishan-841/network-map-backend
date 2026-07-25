# DESIGN_SYSTEM.md

# ISP Coverage – Design System

---

# Design Philosophy

This application is designed for field survey teams who spend most of their time outdoors using mobile devices.

The UI should prioritize:

- Speed
- Readability
- Large touch targets
- Minimal typing
- Map-first workflow
- Enterprise quality
- Clean aesthetics

The design language should feel like a combination of:

- Apple Maps
- Linear
- Arc Browser
- Stripe Dashboard
- Notion

Avoid looking like a traditional ERP or government software.

The application should feel premium, modern and professional.

---

# Design Principles

Always follow these rules.

- White space is a feature.
- Never clutter screens.
- Maps should always feel like the primary feature.
- Cards should contain only important information.
- Large readable typography.
- Soft shadows.
- Rounded corners.
- Minimal borders.
- Smooth transitions.
- Consistent spacing.

---

# Color Theme

Primary Color

Emerald

```
#0F766E
```

Hover

```
#115E59
```

Accent

```
#14B8A6
```

Success

```
#16A34A
```

Warning

```
#D97706
```

Danger

```
#DC2626
```

Info

```
#2563EB
```

Purple (Documents)

```
#7C3AED
```

---

## Final palette — implementation values (approved)

The implementation uses these exact hex values (the approved final table).
Border is `#E2E8F0`; Card is pure `#FFFFFF` by explicit decision.

```
Light:  bg #F8FAFC · card #FFFFFF · border #E2E8F0 · text #0F172A
        muted #64748B · faint #94A3B8 · sidebar #111827
Dark:   bg #0F172A · card #1E293B · border #334155 · text #F8FAFC
        secondary #CBD5E1 · muted #94A3B8 · sidebar #111827
Brand:  primary #0F766E · hover #115E59 · accent #14B8A6
        (dark mode lifts primary to #14B8A6, hover #2DD4BF, for contrast)
Status: success #16A34A · warning #D97706 · danger #DC2626 · info #2563EB
        purple/docs #7C3AED — light tints use the *-50 shades,
        dark tints use deep 900-level shades of the same hues
```

---

# Light Theme

Background

```
#F8FAFC
```

Card

```
#FFFFFF
```

Border

```
#E5E7EB
```

Primary Text

```
#0F172A
```

Secondary Text

```
#64748B
```

Muted

```
#94A3B8
```

---

# Dark Theme

Background

```
#0F172A
```

Sidebar

```
#111827
```

Cards

```
#1E293B
```

Border

```
#334155
```

Primary Text

```
#F8FAFC
```

Secondary

```
#CBD5E1
```

Muted

```
#94A3B8
```

Never use pure black.

Never use pure white.

---

# Typography

Font

Inter

Headings

700 Weight

Body

500 Weight

Labels

500 Weight

Small Labels

400 Weight

Never use more than three font sizes on one screen.

---

# Border Radius

Cards

20px

Buttons

14px

Inputs

14px

Search Bar

999px

Status Pills

999px

Floating Button

24px

---

# Shadow

Cards

Very soft shadow

Never heavy.

Floating Button

Medium shadow.

Dialogs

Soft elevation.

---

# Buttons

Primary

Filled Emerald

White text

Rounded

Height

48px

Secondary

White background

Gray border

Danger

Red

Success

Green

Icon buttons

Circular

44px

Floating Action Button

Bottom Right

64x64

Emerald

White Plus Icon

Large Shadow

---

# Sidebar (Desktop)

Visible only on desktop.

Width

280px

Background

Dark Navy

Menu Items

Icon

Label

Active Item

Emerald border

Slightly lighter background

Bottom section

Current User

Avatar

Role

---

# Bottom Navigation (Mobile)

Visible only on mobile.

Items

Map

Buildings

Profile

Height

72px

Floating Button

Above Bottom Navigation

Center Right

Use blur effect behind navigation.

---

# Page Layout

Desktop

Sidebar

Content

Maximum Content Width

1600px

Centered

Mobile

Full Width

16px padding

Scrollable

---

# Cards

Cards are the primary UI component.

Every building card should include:

Building Name

Address

Status

Zone

Home Pass

Optional Distance

Never overload cards.

Card Layout

Top

Building Name

Status Pill

Middle

Address

Bottom

Zone

Home Pass

Distance

Entire card clickable.

Hover

Small lift animation.

---

# Status Pills

Rounded Pill

Small Dot

Green

Feasible

Orange

Permission Pending

Blue

Survey Pending

Red

Rejected

Gray

Inactive

---

# Search

Search should always be available at top.

Rounded Search Bar

Sticky

Placeholder

Search building...

Leading Icon

Search

Optional Filter Button

On Mobile

Search remains fixed while scrolling.

---

# Forms

Large Inputs

48px Height

Rounded

Minimal Borders

Spacing

24px between sections

16px between fields

Use Step Forms whenever possible.

Never show huge forms.

---

# Map Experience

Maps are the heart of the application.

Always prioritize the map.

Default View

Current User Location

Search Bar

Floating at top

Rounded

Shadow

Map Controls

Bottom Right

Zoom

Locate Me

Layers

Floating Cards

Bottom Sheet

Never cover more than 40% of map.

---

# Building Marker Colors

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

Selected Marker

Scale animation

Pulse

---

# Building Popup

Contains

Building Name

Status

Address

Zone

Home Pass

View Details Button

Navigate Button

---

# Dashboard Cards

Large Numbers

Minimal Text

Small Trend Indicator

Soft Background

No Charts inside Cards

Charts remain below.

---

# Tables

Avoid traditional tables on mobile.

Convert tables into stacked cards.

Desktop may use tables.

---

# Empty States

Always show illustration or icon.

Example

"No Buildings Surveyed"

Provide CTA button.

---

# Loading

Use Skeletons.

Never show spinner for page loading.

Use spinner only for actions.

---

# Animations

Duration

200ms

Hover

Lift

Click

Scale

Drawer

Slide Up

Dialogs

Fade + Scale

Never over animate.

---

# Icons

Use Lucide Icons.

Consistent Stroke Width.

No filled icons.

---

# Responsive Rules

Desktop

>= 1024px

Tablet

768px - 1023px

Mobile

<768px

Desktop

Sidebar

Mobile

Bottom Navigation

Cards resize automatically.

No horizontal scrolling.

---

# Accessibility

Minimum touch target

44px

Minimum font

14px

Buttons

Visible focus state

High contrast.

---

# Future Components

The design system should be reusable for:

- Fiber Routes
- Poles
- Junction Boxes
- Cabinets
- POPs
- OLTs

Every future module must follow this exact design language.

---

# Final Design Goal

Every screen should feel like:

- Fast
- Minimal
- Premium
- Professional
- Map-first
- Mobile-first

The UI should look like software built in 2026, not a traditional enterprise ERP.

When in doubt, remove elements instead of adding more.