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
import {
  PARTIAL_REVENUE_MARK,
  revenueCell,
  revenueText,
} from "../utils/revenue";
import type { RankedGrowthPage } from "../utils/growth-report";

const PAGE_SIZE = 10;

export function GrowthSessionsByPage({
  pages,
  available,
  currency,
}: {
  pages: RankedGrowthPage[];
  available: boolean;
  currency: string | null;
}) {
  const { t, formatNumber } = useI18n();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = pages.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  // A page's revenue is that of the converted sessions that viewed it (spec 7.2).
  const revenue = visible.map((row) =>
    revenueText(row.conversions, row, currency, { t, formatNumber }),
  );
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
  // A Focus row names the page's Weakness, then what it means for that page type.
  const reason = (row: RankedGrowthPage) => {
    const count = formatNumber(row.weakness ?? 0);
    if (row.type === "PRODUCT")
      return t(
        "Weakness {count}: about {count} fewer sessions added to cart here than on your typical product page.",
        { count },
      );
    if (row.type === "COLLECTION")
      return t(
        "Weakness {count}: about {count} fewer sessions continued from here than from your typical collection.",
        { count },
      );
    if (row.type === "BLOG")
      return t(
        "Weakness {count}: about {count} fewer sessions continued from here than from your typical blog post.",
        { count },
      );
    return t(
      "Weakness {count}: about {count} fewer sessions continued from here than from your typical page of this type.",
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
              "Weakness is how many sessions a page lost against the typical page of its type.",
            )}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Key rate is the add-to-cart rate for products and the click-through rate for other pages. A page needs 20 sessions, and 3 pages of the same type, to be ranked.",
            )}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(
              "Conversions and revenue count every converted session that viewed the page, so one order can count on several pages.",
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
        <>
          <DataTable
            columnContentTypes={[
              "text",
              "text",
              "numeric",
              "numeric",
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
              t("Conversions"),
              t("Conversion rate"),
              t("Revenue"),
              t("Weakness"),
            ]}
            rows={visible.map((row, index) => [
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
              formatNumber(row.conversions),
              percent(row.conversionRate),
              revenueCell(revenue[index]),
              row.weakness === null ? "—" : formatNumber(row.weakness),
            ])}
          />
          {revenue.some((text) => text.partial) && (
            <Box padding="400" paddingBlockStart="0">
              <Text as="p" variant="bodySm" tone="subdued">
                {`${PARTIAL_REVENUE_MARK} ${t("Some orders have no recorded amount")}`}
              </Text>
            </Box>
          )}
        </>
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
