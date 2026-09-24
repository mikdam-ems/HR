import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native/WASM and Node-only packages stay out of the bundle.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'exceljs'],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
};

export default nextConfig;
