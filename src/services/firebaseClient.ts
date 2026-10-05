/**
 * Lazy Firebase client used only for Google sign-in. Firebase SDK is loaded on demand so the
 * app has zero Firebase cost unless the user clicks "Continue with Google" and the project is
 * configured via VITE_FIREBASE_* env vars. The resulting ID token is verified server-side.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
};

export function isGoogleAuthEnabled(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
}

/** Opens the Google popup and returns a Firebase ID token for the backend to verify. */
export async function signInWithGoogle(): Promise<string> {
  if (!isGoogleAuthEnabled()) {
    throw new Error('Google sign-in is not configured for this deployment.');
  }
  const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  return credential.user.getIdToken();
}
