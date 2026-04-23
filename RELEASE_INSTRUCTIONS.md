# Инструкция по сборке и релизу обновлений

Ниже команды для полного цикла.

## 1) Скомпилировать `.exe`

```powershell
corepack yarn dist
```

Результат:
- `dist/TeachAxo Setup <version>.exe`
- `dist/latest.yml`

## 2) Подготовить обновление к релизу (создать архив)

```powershell
corepack yarn update:archive
```

Результат:
- `dist/TeachAxo-Update-<version>.zip`

В архив кладется установщик текущей версии.

## 3) Сделать релиз и загрузить архив

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" release create "v<version>" `
  "dist/TeachAxo-Update-<version>.zip" `
  "dist/latest.yml" `
  --title "TeachAxo <version>" `
  --notes "Release <version>"
```

Пример для `1.0.8`:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" release create v1.0.8 `
  "dist/TeachAxo-Update-1.0.8.zip" `
  "dist/latest.yml" `
  --title "TeachAxo 1.0.8" `
  --notes "Release 1.0.8"
```

## Как теперь работает обновление в приложении

1. Приложение проверяет новую версию.
2. Скачивает ZIP-архив `TeachAxo-Update-<version>.zip` из GitHub Release.
3. Распаковывает архив во временную директорию.
4. Находит `.exe` внутри архива и запускает установку в тихом режиме (`/S`).
