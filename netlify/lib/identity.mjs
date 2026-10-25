// Thin seam over @netlify/identity so the same code can be exercised by automated tests.
// In production nothing ever sets globalThis.__FCV_TEST__, so the real SDK is always used.
import * as real from '@netlify/identity';

const impl = () => (globalThis.__FCV_TEST__ && globalThis.__FCV_TEST__.identity) || real;

export const getUser = () => impl().getUser();
export const verifyRequestOrigin = (req, options) => impl().verifyRequestOrigin(req, options);
export const getIdentityConfig = () => impl().getIdentityConfig();
export const getSettings = () => impl().getSettings();
export const identityAdmin = () => impl().admin;
