export const roomRoute = /^\/api\/rooms(?:\/(\d{4}|[a-z0-9]{6})(?:\/(join|action))?)?$/i;
export const roomFile = /^(\d{4}|[A-Z0-9]{6})\.json$/;
export const codeCapacity = 10000;
export const noRoomCodes = '4 位房间码已全部使用，暂时无法创建新房间。';

export function formatCode(number) {
  return String(number).padStart(4, '0');
}

export function randomRoomNumber() {
  return crypto.getRandomValues(new Uint32Array(1))[0] % codeCapacity;
}
