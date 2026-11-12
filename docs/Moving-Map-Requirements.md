# Moving Map Prototype: high-level requirements

**Purpose.** High-level requirements for the functions demonstrated in the tablet mockup, written so the mockup and this list can be read side by side.

**What the mockup is.** A working user-interface mockup that conveys requirements in a practical way. It is not a real system: every external input (threat updates, pairings, jet navigation data, the transfer to the jet) is simulated, and all data is notional.

**Baseline.** Mockup as of 12 November 2026, including the key manager. Branch ccr-cd214cf5-dvzwwh of kylemccranie1/appmock.

**Not yet specified.** Data sources for threats, targets and keys, and the weapons file types and schemas. These are listed on the To be specified sheet and referenced from each requirement they affect.

This file is generated from `Moving-Map-Requirements.xlsx` in the same folder; the workbook is the master copy.

## How to read the columns

- **Type:** *Product* is a requirement on the eventual product. *Mockup only* is needed to run the demonstration and is not part of what is proposed.
- **Origin:** *Stated* was asked for directly. *Assumed* is a design choice made while building the mockup that has not been confirmed.
- **Mockup status:** *Demonstrated*, *Partly demonstrated* or *Not built*. This is the state of the mockup, not of a real system.
- **Open items:** IDs in the "To be specified" section that must be settled before the requirement can be made specific.

## Summary

| Area | Requirements | Stated | Assumed | Demonstrated | Not fully demonstrated |
|---|---|---|---|---|---|
| General | 8 | 3 | 5 | 7 | 1 |
| Map | 6 | 1 | 5 | 5 | 1 |
| Ownship | 7 | 1 | 6 | 7 | 0 |
| Data load | 5 | 2 | 3 | 5 | 0 |
| Ground threats | 11 | 9 | 2 | 10 | 1 |
| Jet data transfer | 10 | 2 | 8 | 10 | 0 |
| Targets | 11 | 4 | 7 | 8 | 3 |
| Key manager | 11 | 3 | 8 | 9 | 2 |
| Demo and simulation | 3 | 2 | 1 | 3 | 0 |
| **Total** | 72 | 27 | 45 | 64 | 8 |

## Requirements

### General

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| GEN-01 | The application shall run on a tablet as an app that can be installed to and launched from the home screen. | Installable web app; no app store needed. | Product | Stated | Demonstrated |  |
| GEN-02 | The application shall remain usable with no network connection once it has been installed. | Offline basemap and all functions work with the network off. | Product | Assumed | Demonstrated |  |
| GEN-03 | Each function shall be delivered as an independent plugin on a common engine, so that functions can be added, changed or removed without altering the others. | Ownship, ground threats, targets and jet transfer are separate plugins. | Product | Stated | Demonstrated |  |
| GEN-04 | The application shall keep loaded mission data, waiting updates and crew decisions across an app restart. | Stored on the device. | Product | Assumed | Demonstrated |  |
| GEN-05 | A notification that needs crew action shall stay on screen until acknowledged. Notifications shall be shown one at a time in the order received, with a count of those still waiting. |  | Product | Assumed | Demonstrated |  |
| GEN-06 | The application shall show the crew the next action to take in a banner over the map rather than inside a menu. | Used for sending changes to the jet. | Product | Stated | Demonstrated |  |
| GEN-07 | The application shall show which software version a device is running. | Shown in the admin console. | Product | Assumed | Demonstrated |  |
| GEN-08 | All controls shall be operable by touch. | Not yet tried on a real tablet. | Product | Assumed | Partly demonstrated |  |

### Map

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| MAP-01 | The application shall display a map that the crew can pan and zoom. |  | Product | Stated | Demonstrated |  |
| MAP-02 | A basemap shall be available with no network connection. | Country outlines only; a detailed offline basemap is not built. | Product | Assumed | Partly demonstrated |  |
| MAP-03 | The application shall offer an optional detailed basemap when a network is available. | Street map, cached as viewed. | Product | Assumed | Demonstrated |  |
| MAP-04 | The map shall show a latitude and longitude grid that adapts to the zoom level. |  | Product | Assumed | Demonstrated |  |
| MAP-05 | The application shall show the coordinates of the point under the cursor or last tap and, when ownship is known, its bearing and range from ownship. |  | Product | Assumed | Demonstrated |  |
| MAP-06 | The crew shall be able to show or hide each overlay independently. | Layers tab. | Product | Assumed | Demonstrated |  |

### Ownship

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| OWN-01 | The application shall display the current position of ownship using navigation data supplied by the jet. | Feed is simulated. | Product | Stated | Demonstrated | OI-08 |
| OWN-02 | The ownship symbol shall point along the aircraft track and leave a trail of recent positions. |  | Product | Assumed | Demonstrated |  |
| OWN-03 | The application shall display ownship position, heading, ground speed and altitude, and the source of that data. | Top bar. | Product | Assumed | Demonstrated | OI-08 |
| OWN-04 | The crew shall be able to keep the map centred on ownship. | Follow button. | Product | Assumed | Demonstrated |  |
| OWN-05 | When the map is moved deliberately, by the crew or to show an update, the application shall stop re-centring on ownship until the crew asks for it again. |  | Product | Assumed | Demonstrated |  |
| OWN-06 | If navigation data stops arriving, the application shall show ownship as stale at its last known position and show how old that position is. | Grey symbol and a counter after 3 seconds without data. | Product | Assumed | Demonstrated | OI-08 |
| OWN-07 | The application shall resume normal ownship display without crew action when navigation data returns. |  | Product | Assumed | Demonstrated |  |

### Data load

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| DAT-01 | The application shall provide one place for loading mission files, with a separate slot for each file type. | Data tab. | Product | Stated | Demonstrated |  |
| DAT-02 | The application shall load a Ground Threat List (GTL) that represents the list the mission takes off with and that the jet already holds. |  | Product | Stated | Demonstrated | OI-02 |
| DAT-03 | A GTL entry shall carry, as a minimum, an identifier, a name, a type, a position and a threat ring size. | Assumed CSV or JSON with id, name, type, lat, lon, radius_nm. Real format not yet specified. | Product | Assumed | Demonstrated | OI-02; OI-03 |
| DAT-04 | The application shall check a file on load, report entries it could not use, and refuse a file with no usable entries. |  | Product | Assumed | Demonstrated | OI-02 |
| DAT-05 | The application shall show, for each slot, the loaded file name, the number of entries and the time loaded, and shall ask for confirmation before replacing or clearing it. |  | Product | Assumed | Demonstrated |  |

### Ground threats

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| THR-01 | The application shall display each ground threat on the map at its position with its threat ring. |  | Product | Stated | Demonstrated |  |
| THR-02 | The application shall accept in-flight updates to the threat picture of these kinds: a new threat, a change of position, a change of type and threat ring size, and a threat that is no longer a threat. | Updates are simulated. | Product | Stated | Demonstrated | OI-01 |
| THR-03 | A threat shall be treated as either present or not present, with no intermediate states, to match the inputs the jet accepts. | Suspected and inactive states were built and then removed. | Product | Stated | Demonstrated | OI-07 |
| THR-04 | When an update arrives, the application shall notify the crew of which threat changed and how, including the previous and new values. |  | Product | Stated | Demonstrated |  |
| THR-05 | The map shall not change to reflect an update until the crew has acknowledged it. |  | Product | Stated | Demonstrated |  |
| THR-06 | After acknowledgement, the map shall show the threat in its updated state together with a reference to what the jet still holds. | Move: ghost at the old position and a line with distance and bearing. Type: old ring dashed. Removal: threat greyed out. New: labelled NEW. | Product | Stated | Demonstrated | OI-11 |
| THR-07 | The application shall track, for each threat, whether the tablet and the jet agree, and shall mark any threat that differs as not in the jet. |  | Product | Stated | Demonstrated | OI-07 |
| THR-08 | Once the jet confirms a change, the application shall remove the reference graphics and show only the updated state. A threat that is no longer a threat shall disappear from the map. |  | Product | Stated | Demonstrated |  |
| THR-09 | Several changes to one threat made before sending shall be combined into a single change to the jet. |  | Product | Assumed | Demonstrated |  |
| THR-10 | The application shall list all threats with their change state, let the crew select one to show it on the map, and keep a record of threats that were removed. | Threats tab. | Product | Assumed | Demonstrated |  |
| THR-11 | The application shall receive threat updates from a defined source in a defined format. | Source and format not yet specified; updates come from the admin console. | Product | Stated | Not built | OI-01; OI-03 |

### Jet data transfer

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| JET-01 | The application shall send changes that the crew has reviewed on the tablet to the jet through a data transfer. | Transfer is simulated. | Product | Stated | Demonstrated | OI-07 |
| JET-02 | When the tablet holds anything the jet does not, the application shall show a banner at the bottom of the map with a single action to send it. |  | Product | Stated | Demonstrated |  |
| JET-03 | Sending to the jet shall always be a deliberate crew action. Acknowledging an update shall not send it. |  | Product | Assumed | Demonstrated | OI-09 |
| JET-04 | The application shall list each difference between the tablet and the jet and let the crew choose which to send. | Jet tab. | Product | Assumed | Demonstrated |  |
| JET-05 | The application shall show the progress of a transfer and its result. |  | Product | Assumed | Demonstrated |  |
| JET-06 | An item shall be treated as held by the jet only after the jet confirms the transfer. | A transfer is all or nothing in the mockup. | Product | Assumed | Demonstrated | OI-07 |
| JET-07 | If a transfer fails, the application shall tell the crew that nothing changed in the jet, keep the changes on the tablet and offer a retry. |  | Product | Assumed | Demonstrated |  |
| JET-08 | When the link to the jet is unavailable, the application shall prevent sending, say why, and keep the changes until the link returns. |  | Product | Assumed | Demonstrated | OI-07 |
| JET-09 | The application shall keep a history of transfers and their outcomes. |  | Product | Assumed | Demonstrated |  |
| JET-10 | One transfer mechanism shall serve every kind of data sent to the jet, so that new kinds can be added without a new crew workflow. | Threat changes and weapon-target pairs share it. | Product | Assumed | Demonstrated | OI-07 |

### Targets

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| TGT-01 | The application shall receive a weapon-target pair together with an accompanying target file. | Pairings are simulated; file format is invented. | Product | Stated | Demonstrated | OI-04; OI-05 |
| TGT-02 | When a pairing arrives, the application shall notify the crew of the target, station, weapon and file. The target shall not be drawn until the crew opens it. |  | Product | Assumed | Demonstrated |  |
| TGT-03 | The application shall let the crew review the target on the map as described by the file, showing the aimpoint, the target area, and the range and bearing from ownship. |  | Product | Stated | Demonstrated | OI-05 |
| TGT-04 | The application shall show the pairing details and the contents of the target file. | Station, weapon, target name, description, aimpoint, elevation, datum, originator, time, raw file. | Product | Assumed | Demonstrated | OI-05 |
| TGT-05 | The application shall check a pairing before the crew decides and show the result of each check. | File integrity; valid coordinates; station holds the named weapon; target inside a threat ring (warning); replaces a loaded target (warning). The set of checks is assumed. | Product | Assumed | Demonstrated | OI-05; OI-06 |
| TGT-06 | The crew shall be able to accept or reject a pairing. A pairing that fails a check shall not be acceptable. |  | Product | Assumed | Demonstrated |  |
| TGT-07 | An accepted pairing shall be sent to the jet to load the target information into the weapon, and shall be shown as loaded on its station once the jet confirms. |  | Product | Stated | Demonstrated | OI-05; OI-07; OI-09 |
| TGT-08 | The application shall show, for each weapon station, the weapon it holds and the state of any target assigned to it. | Loadout of four stations is built in, not read from the jet. | Product | Assumed | Partly demonstrated | OI-06 |
| TGT-09 | A newer pairing for a station shall replace one still waiting for that station, and the application shall keep a record of rejected and replaced pairings. |  | Product | Assumed | Demonstrated |  |
| TGT-10 | When the crew rejects a pairing, the application shall report the rejection to its originator. | Only a message is shown; nothing is sent. | Product | Assumed | Not built | OI-10 |
| TGT-11 | The application shall support the target file type and schema required by each weapon type. | One invented text format for all weapons. | Product | Stated | Not built | OI-05 |

### Key manager

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| KEY-01 | The application shall accept cryptographic keys sent to the tablet and provide a key manager in which the crew can see and manage them. | Keys tab. Keys are simulated. | Product | Stated | Demonstrated | OI-13 |
| KEY-02 | When a key arrives, the application shall notify the crew with a pop-up naming the key, its type and its validity period. |  | Product | Stated | Demonstrated |  |
| KEY-03 | The application shall accept key types it has not held before, add the new type to the key manager, and tell the crew that the type is new. |  | Product | Stated | Demonstrated | OI-13 |
| KEY-04 | The application shall never display key material. Only details about a key shall be shown. | The mockup holds no key material at all: only a label, type, validity period and fingerprint. | Product | Assumed | Demonstrated | OI-14 |
| KEY-05 | The application shall check a key before the crew decides and show the result of each check. | Fingerprint matches; addressed to this tablet; validity period; new key type (warning); supersedes the active key (warning). The set of checks is assumed. | Product | Assumed | Demonstrated | OI-13; OI-14 |
| KEY-06 | The crew shall be able to store or reject a key. A key that fails a check shall not be storable. |  | Product | Assumed | Demonstrated |  |
| KEY-07 | The application shall list stored keys by type and show each as active, not yet in effect, superseded or expired, according to its validity period. |  | Product | Assumed | Demonstrated |  |
| KEY-08 | The application shall warn the crew when a key type it holds keys for has no active key. | Top bar warning. | Product | Assumed | Demonstrated |  |
| KEY-09 | The crew shall be able to delete a single key, and to delete every key on the tablet in one action (zeroize), each with confirmation. |  | Product | Assumed | Demonstrated | OI-14 |
| KEY-10 | When the crew rejects a key, the application shall report the rejection to its originator. | Only a message is shown; nothing is sent. | Product | Assumed | Not built | OI-10 |
| KEY-11 | The application shall make stored keys available to the systems that use them. | Not built. Keys stay on the tablet; nothing consumes them and they are not sent to the jet. | Product | Assumed | Not built | OI-15 |

### Demo and simulation

| ID | Requirement | How the mockup shows it | Type | Origin | Mockup status | Open items |
|---|---|---|---|---|---|---|
| SIM-01 | The mockup shall provide an admin console from which the demonstrator triggers simulated events on command or switches automatic simulations on and off. | See the Simulated events sheet. | Mockup only | Stated | Demonstrated |  |
| SIM-02 | The admin console shall look different from the product interface so that viewers can tell it is not part of what is proposed, and shall be movable so it does not cover what is being shown. | Dashed purple; draggable; position remembered. | Mockup only | Stated | Demonstrated |  |
| SIM-03 | The mockup shall use notional data only and shall say so on screen. | Banner on every screen. The repository and site are public. | Mockup only | Assumed | Demonstrated | OI-12 |

## Simulated events

Each admin console control and the real-world event it stands in for.

| Area | Admin console control | Kind | What it does in the mockup | What it stands in for |
|---|---|---|---|---|
| Ownship | Jet navigation feed | Toggle | Stops and restarts ownship position data. | Loss of the connection that supplies navigation data from the jet. |
| Ownship | Fast time (10x) | Toggle | Flies the simulated jet ten times faster than real time. | Demo convenience only. |
| Ownship | Start racetrack at map centre | Action | Restarts the simulated flight around the current view. | Demo convenience only. |
| Ownship | Start racetrack at the threats | Action | Restarts the simulated flight around the loaded threats. | Demo convenience only. |
| Ground threats | New threat | Action | A threat not in the takeoff list is reported. | An in-flight threat update from the threat data source. |
| Ground threats | Threat position update | Action | A random threat reports a new position 8 to 30 NM away. | An in-flight threat update from the threat data source. |
| Ground threats | Threat type change | Action | A random threat becomes another type with a different ring size. | An in-flight threat update from the threat data source. |
| Ground threats | No longer a threat | Action | A random threat is reported as no longer a threat. | An in-flight threat update from the threat data source. |
| Ground threats | Automatic updates | Toggle | Every 30 seconds a random threat moves or changes type. | A live stream of threat updates. |
| Ground threats | Reset to takeoff list | Action | Undoes every change on the tablet and in the jet. | Demo convenience only. |
| Targets | Weapon-target pair | Action | A pairing and its target file are pushed to the tablet. | A pairing from the target data source. |
| Targets | Pair for the wrong weapon | Action | The pairing names a weapon the station does not hold. | A pairing that does not match the jet loadout. |
| Targets | Pair with a corrupt file | Action | The target file fails its integrity check. | A target file damaged in transit. |
| Targets | Clear all targets | Action | Removes every pairing from the tablet and the weapons. | Demo convenience only. |
| Keys | New key | Action | A key of a type the tablet already knows, valid now for 24 hours. | A key delivery from the key source. |
| Keys | Key of a new type | Action | The first key of a type the tablet has not held before. | Introduction of a new key type. |
| Keys | Key that takes effect later | Action | A key valid from two hours from now. | A key delivered ahead of its validity period. |
| Keys | Key that fails its fingerprint | Action | The key arrives altered or corrupt. | A key damaged or tampered with in transit. |
| Keys | Key for another device | Action | The key is addressed to a different tablet. | A misdirected key delivery. |
| Keys | Expire an active key | Action | An active key reaches the end of its validity period now. | The passage of time to a key changeover. |
| Jet data transfer | Jet link available | Toggle | Makes the jet unreachable so nothing can be sent. | Loss of the tablet-to-jet connection. |
| Jet data transfer | Next transfer fails | Toggle | The jet does not confirm the next transfer. | A transfer the jet rejects or does not acknowledge. |

## To be specified

Open items to settle before the requirements can be made specific.

| ID | Topic | Question to resolve | Current mockup assumption | Affects | Owner | Decision |
|---|---|---|---|---|---|---|
| OI-01 | Threat data source | Where do in-flight threat updates come from, over what connection, and in what message format? How are threats identified so an update can be matched to a GTL entry? | Updates are generated by the admin console as one of four kinds (new, move, type, remove) keyed by the GTL id. | THR |  |  |
| OI-02 | GTL file format and schema | What is the real GTL file type and schema: fields, coordinate format, units, and how the file is delivered to the tablet? | CSV or JSON with id, name, type, lat, lon (decimal degrees) and radius_nm, loaded by file picker. | DAT; THR |  |  |
| OI-03 | Threat types and ring sizes | Where do threat types and their ring sizes come from: the GTL itself, a separate reference file, or the jet? | Ring size is per threat in the GTL. A type change picks another type already present in the loaded GTL. | DAT; THR |  |  |
| OI-04 | Target data source | Who pushes weapon-target pairs, over what connection, and in what message format? Does one message carry one pairing or several? | One pairing per message from a notional sender, generated by the admin console. | TGT |  |  |
| OI-05 | Weapons file types and schemas | Which target file type and schema does each weapon type need? Which fields must the crew see, and how is file integrity proven? | One invented text file of labelled lines for every weapon, with a simple checksum. | TGT |  |  |
| OI-06 | Stores loadout source | How does the tablet learn which weapon is on which station: from the jet, from a mission file, or entered by the crew? | Four stations (3, 4, 6, 7) with two notional weapons, built into the mockup. | TGT |  |  |
| OI-07 | Tablet-to-jet interface | What is the transfer mechanism, what does the jet accept for threats and for weapon loads, and how does it confirm or read back what it now holds? | A simulated transfer that confirms or fails as a whole after about four seconds. | JET; THR; TGT |  |  |
| OI-08 | Ownship navigation source | What interface supplies navigation data to the tablet, at what rate, and with which fields? | Simulated fixes twice a second with position, track, ground speed and altitude. | OWN |  |  |
| OI-09 | Confirmation before loading a weapon | Should sending a weapon load need its own explicit confirmation, separate from threat changes? | One tap on the banner sends everything selected, threats and weapon loads together. | JET; TGT |  |  |
| OI-10 | Reporting a rejection | When the crew rejects a pairing, what goes back to the originator and how? | A message says the sender is told; nothing is sent. | TGT |  |  |
| OI-11 | When a removed threat leaves the map | Should a threat that is no longer a threat disappear on acknowledgement, or stay greyed out until the jet is updated? | It stays greyed out until the change is sent to the jet. | THR |  |  |
| OI-12 | Data handling | Where will real file formats and data live, given the repository and site are public? | Everything in the repository is notional. | GEN; SIM |  |  |
| OI-13 | Key source, types and format | Who sends keys to the tablet, over what connection, and in what format? Which key types are expected, and what identifies a type? | Three notional known types; any other type name is treated as new. One key per delivery from a notional sender. | KEY |  |  |
| OI-14 | Key protection and handling rules | How must keys be stored and protected on the tablet, what proves a key is intact and meant for this device, and what are the rules for deletion and zeroize? | No key material exists in the mockup. A simple fingerprint and a device name stand in for integrity and addressing. | KEY |  |  |
| OI-15 | Use of stored keys | What uses a key once it is on the tablet: the tablet itself, the jet through the data transfer, or both? Does loading a key into the jet follow the same review-then-send flow? | Keys stay on the tablet and nothing uses them. | KEY; JET |  |  |
