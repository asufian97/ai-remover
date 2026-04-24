/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'onnxruntime-node$': false,
        sharp$: false,
      };
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        crypto: false,
      };
    }
    config.module.rules.push({
      test: /\.m?js$/,
      include: /node_modules[\\/](?:@imgly|onnxruntime-web)/,
      resolve: { fullySpecified: false },
      type: 'javascript/auto',
    });
    return config;
  },
};

module.exports = nextConfig;
