/** Fictional, fixed locations used only inside the presentation company. */
export const DEMO_PLACES = [
  { placeId: "demo-clinic", primary: "2030 Demo Medical Center", secondary: "Colorado Springs, CO · Sample destination", address: "2030 Demo Medical Center, Colorado Springs, CO", lat: 38.84, lng: -104.81 },
  { placeId: "demo-home", primary: "12 Example Lane", secondary: "Colorado Springs, CO · Sample pickup", address: "12 Example Lane, Colorado Springs, CO", lat: 38.83, lng: -104.82 },
  { placeId: "demo-dialysis", primary: "Demo Dialysis Center", secondary: "Colorado Springs, CO · Sample destination", address: "Demo Dialysis Center, Colorado Springs, CO", lat: 38.855, lng: -104.795 },
];
export function demoPlaceSuggestions(input: string) {
  const query = input.trim().toLowerCase();
  if (query.length < 3) return [];
  const matches = DEMO_PLACES.filter(p => p.address.toLowerCase().includes(query));
  return matches.length ? matches : DEMO_PLACES;
}
export function resolveDemoPlace(input: string) {
  return DEMO_PLACES.find(p => p.address.toLowerCase() === input.trim().toLowerCase()) ?? demoPlaceSuggestions(input)[0] ?? DEMO_PLACES[0];
}
