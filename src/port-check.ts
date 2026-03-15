import * as net from 'net';

export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        console.error(`Port check error for ${port}:`, err.message);
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(false);
      });
    });

    server.listen(port, '127.0.0.1');
  });
}
