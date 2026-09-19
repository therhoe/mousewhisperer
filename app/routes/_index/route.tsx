import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Snapshot</h1>
        <p className={styles.text}>
          Understand storefront traffic, compare snapshots, and test
          improvements in your Shopify store.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in to Snapshot
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Store and channel snapshots</strong>. See traffic quality
            and where your visitors come from.
          </li>
          <li>
            <strong>Page snapshots</strong>. Review engagement across products,
            collections, pages, and blogs.
          </li>
          <li>
            <strong>A/B tests</strong>. Compare storefront variants and track
            their results.
          </li>
        </ul>
      </div>
    </div>
  );
}
