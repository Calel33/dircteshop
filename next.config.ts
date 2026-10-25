import { withReticle } from '@reticlehq/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Receipt links are bearer capabilities. `no-referrer` keeps the token out
  // of any outbound navigation's Referer header (protocol §6.7).
  async headers() {
    return [
      {
        source: '/order/:token',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default withReticle(nextConfig);
