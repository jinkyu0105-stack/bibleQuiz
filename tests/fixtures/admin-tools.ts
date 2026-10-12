import { expect, type Page } from "@playwright/test";

type AdminToolId = "metadata" | "withdrawal" | "correction" | "cleanup" | "sermon" | "bible";

/** Follow the same disclosure entry point as an operator; never force hidden inputs. */
export async function openAdminTool(page: Page, id: AdminToolId) {
  const tool = page.locator(`[data-admin-tool="${id}"]`);
  if (await tool.getAttribute("open") === null) await tool.locator(":scope > summary").click();
  await expect(tool).toHaveAttribute("open", "");
  return tool;
}
