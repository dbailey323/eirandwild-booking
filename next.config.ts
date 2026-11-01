import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Room for a large client export from Bookwhen in the admin import
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
};

export default nextConfig;
