// Rink landmarks for the lab's "נקודות מגרש" (camera calibration). The ids are the contract with
// video-analysis/rink_points.py (its TEMPLATE maps each id to rink metres) — rename in both places.
// Sides are as SEEN IN THE CAMERA: "שמאל/ימין" = left/right of the screen, "קרוב/רחוק" = to the camera.
// d = [x, y] on a nominal 40×20 m rink for the little diagram only (x right, y far); top = a point 1 m up.

export const RINK_GROUPS = [
  { id: "goalL", label: "שער שמאל", hint: "עמודי השער: הבסיס על הרצפה והפינה העליונה (איפה שהעמוד פוגש את המשקוף)." },
  { id: "goalR", label: "שער ימין", hint: "עמודי השער: הבסיס על הרצפה והפינה העליונה (איפה שהעמוד פוגש את המשקוף)." },
  { id: "boxL", label: "רחבה שמאל", hint: "המלבן מול השער. פינה אחורית = על קו השער, קדמית = הרחוקה מהשער." },
  { id: "boxR", label: "רחבה ימין", hint: "המלבן מול השער. פינה אחורית = על קו השער, קדמית = הרחוקה מהשער." },
  { id: "mid", label: "אמצע המגרש", hint: "קו האמצע והעיגול." },
  { id: "boards", label: "בסיס הקירות", hint: "נקודה בדיוק איפה שהרצפה פוגשת את הקיר — לא על המעקה למעלה. לא בפינות המעוגלות." },
]

const goal = (s, x) => [
  { id: `goal${s}_near_base`, group: `goal${s}`, label: "עמוד קרוב — בסיס", d: [x, -0.85] },
  { id: `goal${s}_far_base`, group: `goal${s}`, label: "עמוד רחוק — בסיס", d: [x, 0.85] },
  { id: `goal${s}_near_top`, group: `goal${s}`, label: "עמוד קרוב — פינה עליונה", d: [x, -0.85], top: true },
  { id: `goal${s}_far_top`, group: `goal${s}`, label: "עמוד רחוק — פינה עליונה", d: [x, 0.85], top: true },
]
const box = (s, gx, fx) => [
  { id: `box${s}_back_near`, group: `box${s}`, label: "פינה אחורית קרובה", d: [gx, -4.5] },
  { id: `box${s}_back_far`, group: `box${s}`, label: "פינה אחורית רחוקה", d: [gx, 4.5] },
  { id: `box${s}_front_near`, group: `box${s}`, label: "פינה קדמית קרובה", d: [fx, -4.5] },
  { id: `box${s}_front_far`, group: `box${s}`, label: "פינה קדמית רחוקה", d: [fx, 4.5] },
  { id: `spot${s}`, group: `box${s}`, label: "נקודת הפנדל", d: [fx, 0] },
]

export const RINK_LANDMARKS = [
  ...goal("L", -17), ...goal("R", 17),
  ...box("L", -17, -11.6), ...box("R", 17, 11.6),
  { id: "c_far", group: "mid", label: "קו האמצע פוגש את הקיר הרחוק", d: [0, 10] },
  { id: "c_near", group: "mid", label: "קו האמצע פוגש את הקיר הקרוב", d: [0, -10] },
  { id: "c_spot", group: "mid", label: "נקודת האמצע", d: [0, 0] },
  { id: "circle_far", group: "mid", label: "העיגול חוצה את קו האמצע — רחוק", d: [0, 3] },
  { id: "circle_near", group: "mid", label: "העיגול חוצה את קו האמצע — קרוב", d: [0, -3] },
  { id: "far_a", group: "boards", label: "קיר רחוק — נקודה 1", d: [-8, 10] },
  { id: "far_b", group: "boards", label: "קיר רחוק — נקודה 2", d: [8, 10] },
  { id: "near_a", group: "boards", label: "קיר קרוב — נקודה 1", d: [-8, -10] },
  { id: "near_b", group: "boards", label: "קיר קרוב — נקודה 2", d: [8, -10] },
  { id: "endL_a", group: "boards", label: "קיר שמאל (מאחורי השער) — 1", d: [-20, -5] },
  { id: "endL_b", group: "boards", label: "קיר שמאל (מאחורי השער) — 2", d: [-20, 5] },
  { id: "endR_a", group: "boards", label: "קיר ימין (מאחורי השער) — 1", d: [20, -5] },
  { id: "endR_b", group: "boards", label: "קיר ימין (מאחורי השער) — 2", d: [20, 5] },
]
export const LANDMARK_BY_ID = Object.fromEntries(RINK_LANDMARKS.map(l => [l.id, l]))
