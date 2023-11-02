import { Chan } from "npm:ts-chan@latest";

const buffer = new Uint8Array(1024 * 1024).fill(100);

const reqCh = new Chan<Request>();
const resCh = new Chan<Response>();

export const handler = async (req: Request) => {
  await reqCh.send(req);
  const next = await resCh.recv();
  if (next.done) {
    throw new Error("unexpected closed channel");
  }
  return next.value;
};

export const worker = async () => {
  for await (const _req of reqCh) {
    await resCh.send(new Response(buffer));
  }
};

if (import.meta.main) {
  void worker();
  Deno.serve({ port: 8080 }, handler);
}
