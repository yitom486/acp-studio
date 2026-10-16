import { test, expect } from "@playwright/test";
import { launchElectronApp, type LaunchedApp } from "./helpers/launch-electron";

test("owns main history, inspects child without switching, and imports external references", async ({}, info) => {
  const launched: LaunchedApp = await launchElectronApp({ env: { ACP_E2E_SUBAGENTS: "1" } });
  const { page } = launched;
  const actions: string[] = [];
  page.on("request", request => { if (request.method() === "POST") actions.push(new URL(request.url()).pathname); });
  try {
    const sidebar = page.locator("aside").first();
    const input = page.locator("textarea").first();
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect(sidebar.getByText("外部已有会话")).toHaveCount(0);
    await input.fill("测试子会话"); await input.press("Enter");
    await expect(page.getByText("主会话正在继续执行", { exact: true })).toBeVisible({ timeout: 15000 });
    await input.fill("主会话未发送的草稿");
    const childMenu = page.getByRole("button", { name: /子任务 1/ });
    await expect(childMenu).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText("检查项目结构")).toHaveCount(0);
    await expect(page.getByText("这是子智能体的独立输出", { exact: true })).toHaveCount(0);
    await childMenu.click(); await page.getByRole("button", { name: "检查项目结构", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "检查项目结构", exact: true });
    await expect(dialog.getByText("这是子智能体的独立输出", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("child-inspection.png") });
    await dialog.getByRole("button", { name: "返回主会话" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(input).toHaveValue("主会话未发送的草稿");
    await expect(page.getByText(/主会话执行完成/)).toBeVisible({ timeout: 10000 });
    expect(actions.filter(action => action.endsWith("/session/new"))).toHaveLength(1);
    expect(actions.some(action => action.endsWith("/session/resume") || action.endsWith("/session/cancel"))).toBe(false);
    await page.getByRole("button", { name: "导入外部历史", exact: true }).click();
    const external = page.getByRole("dialog", { name: "导入外部历史", exact: true });
    await external.getByRole("button", { name: /外部已有会话/ }).click();
    await expect(external).toHaveCount(0);
    await expect(sidebar.getByText("外部已有会话", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("检查项目结构")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("managed-history.png") });
  } finally { await launched.cleanup(); }
});
