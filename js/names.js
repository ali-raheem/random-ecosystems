// Place names for generated worlds: an invented name plus a landform that matches
// the terrain (a wet map is a fen or a lakeland, a wooded one a weald).

const START = ['Ash', 'Bram', 'Cal', 'Dun', 'Eld', 'Fen', 'Gar', 'Hal', 'Kes', 'Lun', 'Mor', 'Nar', 'Oss', 'Pell', 'Quen', 'Ros', 'Sel', 'Tarn', 'Ul', 'Vel', 'Wen', 'Yr'];
const MIDDLE = ['', '', 'a', 'e', 'i', 'o', 'en', 'er', 'an', 'ow'];
const END = ['by', 'dale', 'mere', 'wick', 'holt', 'stead', 'ford', 'moor', 'reach', 'mark', 'combe', 'well'];

export function placeName(rng) {
  return rng.pick(START) + rng.pick(MIDDLE) + rng.pick(END);
}

export function worldName(rng, terrain) {
  const name = placeName(rng);
  let forms;
  if (terrain.wetness > 0.13) forms = ['Fens', 'Lakeland', 'Water Meadows', 'Marshes', 'Broads'];
  else if (terrain.woodland > 0.16) forms = ['Weald', 'Forest', 'Woodlands', 'Chase'];
  else if (terrain.wetness < 0.08) forms = ['Downs', 'Steppe', 'Plains', 'Heath', 'Uplands'];
  else forms = ['Vale', 'Basin', 'Valley', 'Grasslands', 'Moors'];
  return `The ${name} ${rng.pick(forms)}`;
}
