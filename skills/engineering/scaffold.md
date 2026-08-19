# Skill: scaffold — 项目脚手架

## 用途

按项目类型生成标准目录结构，由光头强（架构）和熊二（开发）使用。

## 输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_type | string | 是 | 项目类型：web/api/cli/library |
| project_name | string | 是 | 项目名称 |
| base_dir | string | 是 | 项目根目录绝对路径 |
| tech_stack | string | 否 | 技术栈偏好，如 react/express |

## 输出

生成的目录树（字符串），以及实际创建的目录和文件。

## 模板

### web 项目
```
{project_name}/
├── src/
│   ├── components/
│   ├── pages/
│   ├── utils/
│   ├── styles/
│   └── index.js
├── public/
├── tests/
├── package.json
├── README.md
└── .gitignore
```

### api 项目
```
{project_name}/
├── src/
│   ├── routes/
│   ├── controllers/
│   ├── models/
│   ├── middleware/
│   ├── utils/
│   └── app.js
├── tests/
├── package.json
├── README.md
└── .gitignore
```

### cli 项目
```
{project_name}/
├── src/
│   ├── commands/
│   ├── utils/
│   └── index.js
├── tests/
├── package.json
├── README.md
└── .gitignore
```

### library 项目
```
{project_name}/
├── src/
│   ├── index.js
│   └── utils/
├── dist/
├── tests/
├── package.json
├── README.md
└── .gitignore
```

## 调用示例

```
scaffold(
  project_type="api",
  project_name="bear-shop",
  base_dir="d:/projects/bear-shop",
  tech_stack="express"
)
```
