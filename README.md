
![Logo](image link)
# PathAble

A map for people with disabilities or injuries.


## Authors

- [@JummyJoeJackson](https://www.github.com/JummyJoeJackson) (Front & Back-End)
- [@vkreji](https://www.github.com/vkreji) (Graphic Design)
- [@serene-x](https://github.com/serene-x) (Database)


## Features

- Optimized Routing for Accessibility Needs
- Accessibility Information
- Search Nearby Locations (w/ Accessibility Ratings)
- Filter Locations by Accessibility


## Environment Variables

To run this project, you will need to add the following environment variables in a .env file to both `pathable` and `pathable\workspace`

`EXPO_PUBLIC_API_URL`: URL of the server where the back-end is hosted

`GOOGLE_MAPS_API_KEY`: API key for google maps


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
  .venv\Scripts\activate
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

Have Fun! 😊