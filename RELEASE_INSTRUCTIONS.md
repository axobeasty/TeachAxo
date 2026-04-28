# Инструкция по сборке и релизу обновлений

Ниже команды для полного цикла публикации.

## Релиз основного приложения TeachAxo

### 1) Скомпилировать `.exe`

```powershell
corepack yarn dist
```

Результат:
- `dist/TeachAxo Setup <version>.exe`
- `dist/latest.yml`

### 2) Подготовить обновление к релизу (создать архив)

```powershell
corepack yarn update:archive
```

Результат:
- `dist/TeachAxo-Update-<version>.zip`

В архив кладется установщик текущей версии.

### 3) Создать релиз для TeachAxo

Тег для основной программы: `v<version>`

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" release create "v<version>" `
  "dist/TeachAxo-Update-<version>.zip" `
  "dist/latest.yml" `
  --title "TeachAxo <version>" `
  --notes "Release <version>"
```

## Релиз агента TeachAxo Agent

### 1) Скомпилировать агент `.exe`

```powershell
corepack yarn agent:dist
```

Результат:
- `dist-agent/TeachAxo Agent Setup <version>.exe`
- `dist-agent/latest.yml`

### 2) Создать отдельный релиз для агента

Тег для агента: `agent-v<version>`

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" release create "agent-v<version>" `
  "dist-agent/TeachAxo Agent Setup <version>.exe" `
  "dist-agent/latest.yml" `
  --title "TeachAxo Agent <version>" `
  --notes "Agent release <version>"
```

## Как работает автообновление

### Основное приложение
1. TeachAxo проверяет новую версию.
2. Скачивает ZIP-архив `TeachAxo-Update-<version>.zip` из релиза `v<version>`.
3. Распаковывает архив во временную директорию.
4. Находит `.exe` внутри архива и запускает установку.

### Агент
1. Агент проверяет GitHub релизы с тегами `agent-v*`.
2. Находит последний релиз агента и сравнивает версию со своей.
3. Скачивает `TeachAxo Agent Setup <version>.exe`.
4. Запускает установщик и перезапускается уже в новой версии.
