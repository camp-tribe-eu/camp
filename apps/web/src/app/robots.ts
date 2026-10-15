import type { MetadataRoute } from 'next';
import { isPublic } from '@/lib/environment';
import { robotsFor } from '@/lib/robots-rules';

// CAMP-90. Two different files depending on the mode, because a closed
// environment and a live one need opposite things. The rules themselves are in
// lib/robots-rules.ts, where a test can ask for either mode.

export default function robots(): MetadataRoute.Robots {
  return robotsFor(isPublic);
}
