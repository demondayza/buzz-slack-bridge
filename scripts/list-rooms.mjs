const homeserver = (process.env.MATRIX_HOMESERVER_URL ?? "http://127.0.0.1:8008").replace(
  /\/$/,
  "",
);
const token = process.env.MATRIX_ACCESS_TOKEN;
if (!token) throw new Error("MATRIX_ACCESS_TOKEN is required");

const request = async (path) => {
  const response = await fetch(`${homeserver}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};

const { joined_rooms: roomIds } = await request("/_matrix/client/v3/joined_rooms");
const rooms = await Promise.all(
  roomIds.map(async (roomId) => {
    let name = "(unnamed room)";
    try {
      const state = await request(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`,
      );
      name = state.name ?? name;
    } catch {
      // Rooms do not need an explicit name.
    }
    return { name, roomId };
  }),
);

console.table(rooms.sort((left, right) => left.name.localeCompare(right.name)));
