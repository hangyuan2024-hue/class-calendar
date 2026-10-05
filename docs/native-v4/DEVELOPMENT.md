# Native Android implementation notes

Baseline: `hangyuan2024-hue/class-calendar` main commit `34aa5eb`. Native V4 work is isolated from website and desktop source changes. Stable product version names are `3.0.<APP_VERSION_CODE>`.

## Build

Use JDK17, Gradle8.9, Android SDK34 and the project's existing Android Gradle Plugin8.5.2. No Google Play Services, third-party UI SDK or embedded web runtime is required.

```sh
# A separately installable development APK:
gradle -p android assemblePreviewDebug --no-daemon

# Existing production identity; requires the existing release.jks and its password:
APP_VERSION_CODE=YOUR_NEXT_VERSION_CODE KEYSTORE_PASSWORD=YOUR_EXISTING_PASSWORD \
  gradle -p android assembleStableRelease --no-daemon
```

`YOUR_NEXT_VERSION_CODE` must exceed the version installed on the phone. The maintained GitHub workflow uses its existing run number and certificate. Do not redistribute signing keys in source/update archives.

The delivered preview APK was compiled with aapt2, javac17 and D8, aligned and verified with apksigner against SDK34, then installed on an emulator. Its independent preview certificate and package ID are intentionally unsuitable for overwriting the user's signed stable APK. Full Gradle/Actions execution was not possible without the existing signing secret; it remains an acceptance step in the user's repository.

## Structure

| Source | Responsibility |
| --- | --- |
| CampusActivity / CampusUi / CampusHome | Activity lifecycle, native routing, design system, persistent custom home layout |
| CampusSchool / CampusCourses | Calendar, assignments, classes, permissions, timetable/recurrence/OCR/ICS |
| CampusLearn / CampusPlanner / CampusWorld | Learning records, habits, countdown/ledger/wrongbook/diary, plans, durable focus timer, metaverse |
| CampusExtras / CampusWords | Native adapters for published HTML tools and compressed offline resource books |
| CampusSocial / CampusManage | Wall, members, profiles, assistant, roles, plugin administration, preferences and backups |
| CampusPhone / CampusWidget / LectureService | Android system integrations and account-bound media |
| CampusApi / CampusSecret / CampusStore | Existing HTTPS API, Keystore-protected sessions, isolated records, durable sync outbox |

`MainActivity` and `CloudActivity` remain native aliases for compatibility with old source uploads and private launch intents. `assets/offline.html` is empty; it is retained so a novice can update by overwriting existing files. No active website payload is shipped.

## Data and contracts

The public backend URL and anonymous key use existing website configuration. Authenticated calls use the signed-in user's token. No server secrets or service-role key are shipped. Public catalog inspection discovered the nine native adapters documented in README.

18 existing website namespaces are recognized by `CampusStore.KINDS`, with the same per-record namespace/key/time/tombstone protocol. A durable queue retains offline edits, detects concurrent changes before acknowledgement, and preserves account separation. Course synchronization uses existing `courses_get` / `courses_sync` plus original payload limits. Website callback/RPC name comparison covers 97 existing names; name coverage is not proof of successful authenticated calls.

New native tool data and media stay local unless an existing explicit server contract is used. Adding unsupported namespaces to `udata_push` without a backend migration would create a false claim of cloud sync. Add a reviewed backend contract and native adapter when extending these features.

Backups omit sessions, account tokens, active timers, device privacy/DND settings and cached class data. Restore validates known structures and commits atomically; attachments use safe private filenames, collision checking and rollback on failure. Restored syncable learning changes remain queued with sync paused until reviewed.

Focus completion is based on a persisted deadline and timer ID, not screen animation. An atomic batch records the learning event and marks the timer settled exactly once. Receiver and widget instances share committed account state. Interrupted recordings are reconciled against actual media metadata before appearing as recovered recordings.

## Verification

`checks/device_checks.py` targets a disposable emulator and the debug preview package only. **Do not run its data-writing phases on a personal device.** Install the preview APK, forward/provide ADB TCP port5555, and install Python `adb-shell`:

```sh
python -m pip install adb-shell
python docs/native-v4/checks/device_checks.py --phase screens --output ./native-check-results
python docs/native-v4/checks/device_checks.py --phase forms --output ./native-check-results
python docs/native-v4/checks/device_checks.py --phase peripherals --output ./native-check-results
# Additional media checks require Pillow:
python -m pip install Pillow
python docs/native-v4/checks/device_checks.py --phase media --output ./native-check-results
```

The script verifies native accessibility hierarchies, route opening, 320dp navigation, actual UI CRUD and restart persistence, integer cents, stored timer completion, Android share reception, notifications and platform widget confirmation. Existing results are included separately. Screenshots show disposable test data, not application defaults.

JVM tests under `checks/jvm` compile the real business code against org.json and an Android compile JAR. Context/SharedPreferences and CampusApi mocks belong only to the JVM test classpath. Never put them under `android/app/src/main` or include them in an APK. `CoreChecks` exercises recurrence, money/CSV, Unicode-safe ICS, committed-state isolation, failed writes, sync queues/tombstones, growth events, backup validation and metaverse calculations.

Remaining acceptance: authenticated student/teacher/admin operations, email delivery, live OCR, real speech/camera/microphone/biometric/location services, Huawei background behavior and original-certificate installation. No production database data was changed for these tests.
