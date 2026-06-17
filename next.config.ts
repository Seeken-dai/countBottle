import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/google.firestore.v1.Firestore/:path*',
        destination: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/:path*'
      },
      {
        source: '/v1/projects/:path*',
        destination: 'https://firestore.googleapis.com/v1/projects/:path*'
      }
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
