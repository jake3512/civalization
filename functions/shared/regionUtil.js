// js/multiplayer.js의 REGION_SIZE·regionKey와 반드시 동일한 값을 유지해야 함
export const REGION_SIZE = 100;
export function regionKeyOf(x, y) {
  return `${Math.floor(x / REGION_SIZE)}_${Math.floor(y / REGION_SIZE)}`;
}
