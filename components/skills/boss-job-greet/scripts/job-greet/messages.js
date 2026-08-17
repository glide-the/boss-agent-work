// messages.js — 求职消息模板（第一句与岗位需求相关，后续短句取自简历）
// 简历身份：张毛峰，AI Agent 应用工程师（LLM 应用 / Agent 工作流 / RAG·MCP / 长期记忆）
export function aiMsgs(jobTitle) {
  return [
    `您好，我对贵司「${jobTitle}」岗位很感兴趣，岗位的大模型/AI 应用落地方向正是我主攻的方向。`,
    "我有 LLM 应用工程与 Agent 工作流实战经验，熟悉 RAG、MCP 与 tool calling。",
    "我独立设计过情感化宠物 Agent，覆盖角色生成、长短期记忆与 text/action/emotion 结构化输出协议。",
    "我是 Langchain-Chatchat 开源项目核心贡献者，也参与过智谱 AI 生态 SDK 与 RAG 工程化。",
    "技术栈以 TypeScript/Python 为主，熟悉 FastAPI、Docker、Redis，一个月内可到岗，期待进一步沟通。",
  ];
}

export function pmMsgs(jobTitle) {
  return [
    `您好，我对贵司「${jobTitle}」岗位很感兴趣，AI 产品方向我有技术+产品的复合背景。`,
    "我有多年 LLM 应用与 AI Agent 开发经验，负责过情感化陪伴 Agent 的角色定义、AI Profile 与评测体系设计。",
    "我习惯用 PRD 与阶段文档推进需求，能独立拆解模糊需求为可落地的 Agent 工作流。",
    "熟悉 RAG、MCP 与主流大模型能力边界，技术和产品两边都能深入对话，一个月内可到岗，期待进一步沟通。",
  ];
}

export function itMsgs(jobTitle) {
  return [
    `您好，我在找 IT 技术支持方向的岗位，看到贵司「${jobTitle}」这个职位与我很匹配。`,
    "我熟悉 Docker、PostgreSQL、Redis、RabbitMQ 等环境的搭建与运维。",
    "我也做过 LLM 应用开发，问题排查和定位经验丰富，文档与沟通都没问题。",
    "学习能力强，能快速上手新业务，一个月内可到岗，期待进一步沟通。",
  ];
}

export function emotionMsgs(jobTitle) {
  return [
    `您好，我对贵司「${jobTitle}」岗位很感兴趣，AI 情感陪伴方向我有一线实战经验。`,
    "我独立设计过情感化宠物 Agent，覆盖角色生成、AI Profile、长短期记忆、聊天交互与主动消息触发链路。",
    "我设计过 text/action/emotion 结构化输出协议，并搭建过 Golden Case 多轮对话评测集与裁判 Prompt。",
    "技术上熟悉 RAG、MCP、tool calling，是 Langchain-Chatchat 开源项目核心贡献者。",
    "技术栈以 TypeScript/Python 为主，一个月内可到岗，期待进一步沟通。",
  ];
}

export function algoMsgs(jobTitle) {
  return [
    `您好，我对贵司「${jobTitle}」岗位很感兴趣，岗位的算法与模型应用方向与我的工程经验很匹配。`,
    "我有 LLM 应用工程与 Agent 工作流经验，熟悉 RAG、向量检索、Prompt 工程与 Golden Case 评测体系搭建。",
    "我做过情感化宠物 Agent 与多 Agent 协作流水线，也参与过智谱 AI 生态与 Langchain-Chatchat 开源项目。",
    "技术栈以 Python/TypeScript 为主，熟悉 FastAPI、Docker、PostgreSQL，一个月内可到岗，期待进一步沟通。",
  ];
}

export function pickMsgs(kind, jobTitle) {
  if (customMsgs.has(kind)) return customMsgs.get(kind)(jobTitle);
  if (kind === "pm") return pmMsgs(jobTitle);
  if (kind === "emotion") return emotionMsgs(jobTitle);
  if (kind === "it") return itMsgs(jobTitle);
  if (kind === "algo") return algoMsgs(jobTitle);
  return aiMsgs(jobTitle);
}

// 运行时按任务方向动态注册消息生成器（覆盖内置模板）
// fn: (jobTitle) => string[]，第一句必须与岗位需求相关，后续短句取自简历
const customMsgs = new Map();
export function setMsgsForKind(kind, fn) {
  customMsgs.set(kind, fn);
}
export function clearCustomMsgs() {
  customMsgs.clear();
}
