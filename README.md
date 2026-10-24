# Grammar Castle

A multiplayer grammar dungeon crawler for English learners. Students explore a shared 41-floor castle, battle monsters by answering multiple-choice grammar questions (A1 to B2), and vote together before climbing the stairs.

**Play:** open the GitHub Pages link for this repository.

## Playing together

Players share one castle through a free Firebase Realtime Database. Without it, the game still works, but each device plays its own castle.

1. Create a project at <https://console.firebase.google.com>.
2. **Build → Realtime Database → Create database.**
3. Open the **Rules** tab, paste the contents of `database.rules.json`, and click **Publish**.
4. In **Project settings → Your apps**, add a web app (`</>`), copy its `firebaseConfig`, and paste it into `firebase-config.js` as `window.FIREBASE_CONFIG = { ... }`.
5. In the same file, set `window.TEACHER_WORD` to a word only you know. Open the game with `#yourword` on the end of the link to get the teacher's "Climb now" button.

## Class games

- **Teacher:** open the game with `#yourword` on the end of the link. You get the teacher leaderboard: press **Start game** to get a class code (like `OWL-482`), project it, and press **End game** when the lesson is over. **Boot** removes a player; they can only rejoin with a different name.
- **Students:** type their name, pick a hero, enter the class code and join the class castle. Without a code they play on their own, saved on their device.
- Each class game starts every hero at level 1.

## How the shared castle works

- Everyone who opens the link joins the same castle and sees each other move.
- A monster's wounds are shared, so classmates can finish what someone else started.
- Finding the stairs opens a vote, and the class only climbs when everyone in the castle is ready.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The game |
| `net-firebase.js` | Connects the game to Firebase |
| `firebase-config.js` | Your Firebase settings and teacher word |
| `database.rules.json` | Database rules to paste into Firebase |
| `a/` | Sprites, rooms and monsters |
