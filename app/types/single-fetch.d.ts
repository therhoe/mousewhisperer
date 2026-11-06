// Remix v2 single-fetch typings. Deleted when the app moves to React Router 7.
import "@remix-run/server-runtime";

declare module "@remix-run/server-runtime" {
  interface Future {
    v3_singleFetch: true;
  }
}
