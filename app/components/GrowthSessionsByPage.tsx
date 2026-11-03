import { useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  InlineStack,
  Pagination,
  Text,
} from "@shopify/polaris";
import { useI18n } from "../utils/i18n";
import type { RankedGrowthPage } from "../utils/growth-report";

const PAGE_SIZE = 10;

export function GrowthSessionsByPage({
  pages,
  available,
}: {
  pages: RankedGrowthPage[];
  available: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const percent = (value: number | null) =>
    value === null
      ? "—"
      : `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
  const typeLabel = (type: string | null) =>
    type === "PRODUCT"
      ? t("Product")
      : type === "COLLECTION"
        ? t("Collection")
        : type === "BLOG"
          ? t("Blog")
          : type === "PAGE"
            ? t("Page")
            : type === "HOMEPAGE"
              ? t("Homepage")
              : t("Other");
  const reason = (row: RankedGrowthPage) => {
    const count = formatNumber(row.missed ?? 0);
    if (row.type === "PRODUCT")
      return t(
        "About {count} more sessions would have added to cart if this page matched your other products.",
        { count },
      );
    if (row.type === "COLLECTION")
      return t(
        "About {count} more sessions would have continued if this page matched your other collections.",
        { count },
      );
    if (row.type === "BLOG")
      return t(
        "About {count} more sessions would have continued if this page matched your other blog posts.",
        { count },
      );
    return t(
      "About {count} more sessions would have continued if this page matched your other pages.",
      { count },
    );
  };
  const focus = pages.filter((row) => row.focus);
  return (
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="200">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {t("Sessions by page")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Key rate is the add-to-cart rate for products and the click-through rate for other pages. A page needs 20 sessions, and 3 pages of the same type, to be ranked.",
            )}
          </Text>
          {focus.map((row) => (
            <InlineStack key={row.path} gap="200" blockAlign="center">
              <Badge tone="attention">{t("Focus here")}</Badge>
              <Text as="span" fontWeight="semibold">
                {row.path}
              </Text>
              <Text as="span" variant="bodySm">
                {reason(row)}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </Box>
      {!available ? (
        <Box padding="400">
          <Text as="p" tone="subdued">
            {t("Not recorded for this measurement")}
          </Text>
        </Box>
      ) : pages.length ? (
        <DataTable
          columnContentTypes={[
            "text",
            "text",
            "numeric",
            "numeric",
            "numeric",
            "numeric",
            "numeric",
          ]}
          headings={[
            t("Page"),
            t("Type"),
            t("Sessions"),
            t("Key rate"),
            t("Exit rate"),
            t("Conversion rate"),
            t("Missed sessions"),
          ]}
          rows={pages
            .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
            .map((row) => [
              row.focus ? (
                <InlineStack gap="100" blockAlign="center" wrap={false}>
                  <Badge tone="attention">{t("Focus here")}</Badge>
                  <span>{row.path}</span>
                </InlineStack>
              ) : (
                row.path
              ),
              typeLabel(row.type),
              formatNumber(row.sessions),
              percent(row.keyRate),
              percent(row.exitRate),
              percent(row.conversionRate),
              row.missed === null ? "—" : formatNumber(row.missed),
            ])}
        />
      ) : (
        <Box padding="400">
          <Text as="p" tone="subdued">
            {t("No sessions match these filters.")}
          </Text>
        </Box>
      )}
      {pageCount > 1 && (
        <Box padding="300">
          <InlineStack align="center">
            <Pagination
              hasPrevious={current > 0}
              onPrevious={() => setPage(current - 1)}
              hasNext={current + 1 < pageCount}
              onNext={() => setPage(current + 1)}
              label={t("Page {page} of {pages}", {
                page: formatNumber(current + 1),
                pages: formatNumber(pageCount),
              })}
            />
          </InlineStack>
        </Box>
      )}
    </Card>
  );
}
