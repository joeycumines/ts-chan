const buffer = new Uint8Array(1024 * 1024).fill(100);

export const handler = () => {
  return new Response(buffer);
};

if (import.meta.main) {
  Deno.serve({ port: 8080 }, handler);
}
