
![Logo](https://github.com/user-attachments/assets/3abcce70-fde6-424a-b165-828304f871c4)
# PathAble

A map for people with disabilities or injuries.


## Authors

- [@JummyJoeJackson](https://www.github.com/JummyJoeJackson) (Front & Back-End)
- [@vkreji](https://www.github.com/vkreji) (Graphic Design)
- [@serene-x](https://github.com/serene-x) (Front & Back-End)


## Features

- Optimized Routing for Accessibility Needs
- Accessibility Information (w/ AI Summary)
- Search Nearby Locations (w/ Accessibility Ratings)
- Filter Locations by Accessibility


## Environment Variables

To run this project, you will need to add the following environment variables in a .env file to the both `pathable` and `pathable\workspace` folders

`EXPO_PUBLIC_API_URL`: URL of the server where the back-end is hosted

`GOOGLE_MAPS_API_KEY`: API key for google maps

`EXPO_PUBLIC_FIREBASE_API_KEY`: API key for firebase

`EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`: Firebase authentication domain

`EXPO_PUBLIC_FIREBASE_PROJECT_ID`: Firebase project id

`EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`: Firebase storage location

`EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: Firebase messaging id

`EXPO_PUBLIC_FIREBASE_APP_ID`: Firebase app id

`EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`: Firebase measurement id

## Run Locally

Clone the project

```bash
  git clone https://github.com/JummyJoeJackson/pathable
```

Go to the project directory

```bash
  cd path\to\pathable
```

🏁 Start the Backend Server

```bash
  python -m venv venv
  .\venv\Scripts\activate
  python backend\main.py
```

⬇️ Install Dependencies 

```bash
  cd workspace
  npm install
```

🚀 Launch the Expo Frontend

```
  npx expo start
```

Optionally, you can just run the `run_app.bat` file

Have Fun! 😊
