#targetengine "rebranding_super_script_v4"

(function() {
    // --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (Память пульта) ---
    if (!$.global.rebrandStateV4) {
        $.global.rebrandStateV4 = {
            baseFolder: null,
            barcodesFolder: null,
            outputFolder: null,
            csvData: [],
            headers: { txtFields: {} },
            currentArticle: "",
            csvRowData: null,
            extractedOEM: "",
            extractedComp: "",
            extractedAxis: "",
            boxDocName: "" // Память для возврата к коробке после стикера
        };
    }
    var state = $.global.rebrandStateV4;

    if ($.global.rebrandWindowV4 && $.global.rebrandWindowV4 instanceof Window) {
        $.global.rebrandWindowV4.close();
    }

    // --- БРОНЕБОЙНЫЙ ПАРСЕР CSV ---
    function parseCSV(content, delimiter) {
        var rows = [];
        var currentRow = [];
        var currentCell = '';
        var insideQuotes = false;
        for (var i = 0; i < content.length; i++) {
            var ch = content[i];
            var nextCh = content[i+1];
            if (ch === '"') {
                if (insideQuotes && nextCh === '"') {
                    currentCell += '"'; i++; 
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (ch === delimiter && !insideQuotes) {
                currentRow.push(currentCell);
                currentCell = '';
            } else if ((ch === '\r' || ch === '\n') && !insideQuotes) {
                if (ch === '\r' && nextCh === '\n') i++; 
                currentRow.push(currentCell);
                if (currentRow.length > 1 || currentRow[0] !== "") rows.push(currentRow);
                currentRow = []; currentCell = '';
            } else {
                currentCell += ch;
            }
        }
        if (currentCell !== '' || currentRow.length > 0) {
            currentRow.push(currentCell); rows.push(currentRow);
        }
        return rows;
    }

    // --- ФУНКЦИИ ЗАМЕНЫ ТЕКСТА ---
    function replacePlaceholder(doc, placeholder, newText, makeRegular) {
        if (!newText) newText = "";
        newText = newText.replace(/\r\n|\n|\r/g, '\n');
        
        app.findGrepPreferences = NothingEnum.nothing;
        app.changeGrepPreferences = NothingEnum.nothing;
        var safePlaceholder = placeholder.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
        app.findGrepPreferences.findWhat = safePlaceholder;
        
        try {
            var finds = doc.findGrep();
            for (var i = finds.length - 1; i >= 0; i--) {
                try {
                    var match = finds[i];
                    var startIdx = match.index;
                    match.contents = newText; 
                    
                    if (makeRegular && newText !== "") {
                        try {
                            var insertedText = match.parent.characters.itemByRange(startIdx, startIdx + newText.length - 1);
                            insertedText.fontStyle = "Regular";
                        } catch(e) {}
                    }
                } catch(e) {} 
            }
        } catch(e) {} 
    }

    function exportPDF(doc, file) {
        try {
            var preset = app.pdfExportPresets.item("[High Quality Print]");
            if (!preset.isValid) preset = app.pdfExportPresets.firstItem();
            doc.exportFile(ExportFormat.PDF_TYPE, file, false, preset);
        } catch(e) {}
    }

    // --- СОЗДАНИЕ ИНТЕРФЕЙСА (ПУЛЬТ) ---
    var win = new Window("palette", "Конвейер Ребрендинга V4 (Dynamic)", undefined, {closeButton: true});
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.margins = 15; win.spacing = 15;

    var panelInit = win.add("panel", undefined, "СТАРТ: Подготовка базы");
    panelInit.orientation = "column"; panelInit.margins = 10; panelInit.alignChildren = ["fill", "top"];
    var btnInit = panelInit.add("button", undefined, "Указать главную папку...");

    var panelWork = win.add("panel", undefined, "РАБОЧИЙ ПРОЦЕСС");
    panelWork.orientation = "column"; panelWork.margins = 15; panelWork.spacing = 5;
    panelWork.alignChildren = ["fill", "top"];

    var lblStep1 = panelWork.add("statictext", undefined, "1. Откройте старый макет коробки:");
    var btnStep1 = panelWork.add("button", undefined, "ШАГ 1: Анализ (ШК, ОЕМ, Схема)");
    
    // --- ОКНО ОШИБОК И ПРОВЕРОК ---
    var reportPanel = panelWork.add("panel", undefined, "Отчет проверок:");
    reportPanel.orientation = "column";
    reportPanel.margins = 10; reportPanel.spacing = 5;
    reportPanel.alignChildren = ["fill", "top"];

    var txtSizeStatus = reportPanel.add("statictext", undefined, "Размер: Ожидание...", {multiline: true});
    txtSizeStatus.preferredSize = [260, 55];
    try { txtSizeStatus.graphics.font = ScriptUI.newFont("dialog", "BOLD", 11); } catch(e) {}

    var txtBarcodeStatus = reportPanel.add("statictext", undefined, "Штрихкод: Ожидание...", {multiline: true});
    txtBarcodeStatus.preferredSize = [260, 45];
    try { txtBarcodeStatus.graphics.font = ScriptUI.newFont("dialog", "BOLD", 11); } catch(e) {}
    // -------------------------------
    
    var lblStep2 = panelWork.add("statictext", undefined, "2. Удалите лишнее с коробки и жмите:", {multiline: true});
    var btnStep2 = panelWork.add("button", undefined, "ШАГ 2: Генерация (Стикер + Дизайн)");
    
    panelWork.add("statictext", undefined, "").preferredSize = [-1, 5]; 

    // НОВЫЙ ШАГ 2.5
    var lblStep2_5 = panelWork.add("statictext", undefined, "2.5. Внесите ручные правки в стикер и сохраните:", {multiline: true});
    var btnStep2_5 = panelWork.add("button", undefined, "ШАГ 2.5: Сохранить стикер");

    panelWork.add("statictext", undefined, "").preferredSize = [-1, 5]; 

    var lblStep3 = panelWork.add("statictext", undefined, "3. Выровняйте макет и стикер на коробке:", {multiline: true});
    var btnStep3 = panelWork.add("button", undefined, "ШАГ 3: Сохранить Финал");
    
    btnStep1.enabled = false; btnStep2.enabled = false; btnStep2_5.enabled = false; btnStep3.enabled = false;

    var statusText = win.add("statictext", undefined, "Ожидание: Укажите папку проекта", {multiline: true});
    statusText.preferredSize = [250, 50]; 
    statusText.justify = "center";

    $.global.rebrandWindowV4 = win;

    // --- ЛОГИКА КНОПОК ---

    btnInit.onClick = function() {
        var folder = Folder.selectDialog("Укажите ГЛАВНУЮ папку проекта (где шаблоны и data.csv):");
        if (!folder) return;
        
        state.baseFolder = folder;
        state.barcodesFolder = new Folder(folder.fsName + "/Barcodes");
        state.outputFolder = new Folder(folder.fsName + "/Output");
        
        if (!state.barcodesFolder.exists) state.barcodesFolder.create();
        if (!state.outputFolder.exists) state.outputFolder.create();

        var csvFile = new File(folder.fsName + "/data.csv");
        if (!csvFile.exists) {
            statusText.text = "ОШИБКА: Не найден файл data.csv!"; return;
        }

        csvFile.open("r");
        csvFile.encoding = "UTF-8";
        var content = csvFile.read();
        csvFile.close();
        
        var delimiter = content.indexOf(';') !== -1 ? ';' : ',';
        state.csvData = parseCSV(content, delimiter);
        
        state.headers = { txtFields: {} };
        var headersLine = state.csvData[0];
        
        for (var i=0; i<headersLine.length; i++) {
            var hRaw = headersLine[i].replace(/^\s+|\s+$/g, '');
            var hLow = hRaw.toLowerCase();
            
            if (hLow === "item no." || hLow === "item no" || hLow === "артикул") {
                state.headers.art = i;
            } else if (hLow === "size_box" || hLow === "size box") {
                state.headers.sizeBox = i;
            } else if (hRaw.indexOf("TXT_") === 0) {
                state.headers.txtFields[hRaw] = i; 
            }
        }

        if (state.headers.art === undefined) {
            statusText.text = "ОШИБКА: В таблице нет колонки 'Item No.' или 'Артикул'!"; return;
        }

        btnInit.enabled = false;
        btnStep1.enabled = true;
        statusText.text = "База загружена. TXT-поля распознаны.\nОткройте коробку и жмите Шаг 1!";
    };

    btnStep1.onClick = function() {
        if (app.documents.length === 0) {
            statusText.text = "Откройте старый макет коробки!"; return;
        }
        var doc = app.activeDocument;
        state.boxDocName = doc.name; // Запоминаем имя документа коробки
        
        txtSizeStatus.text = "Анализ размера...";
        txtBarcodeStatus.text = "Анализ штрихкода...";
        try { txtSizeStatus.graphics.foregroundColor = txtSizeStatus.graphics.newPen(txtSizeStatus.graphics.PenType.SOLID_COLOR, [0,0,0,1], 1); } catch(e) {}
        try { txtBarcodeStatus.graphics.foregroundColor = txtBarcodeStatus.graphics.newPen(txtBarcodeStatus.graphics.PenType.SOLID_COLOR, [0,0,0,1], 1); } catch(e) {}
        
        var links = doc.links;
        var barcodeFound = false;
        var schemaSizeLink = "";
        var schemeRegex = /\d+\s*[xх]\s*\d+\s*[xх]\s*\d+/i; 
        
        for (var i = 0; i < links.length; i++) {
            var linkName = links[i].name.toLowerCase();
            if (linkName.indexOf(".pdf") !== -1) {
                if (schemeRegex.test(linkName)) {
                    schemaSizeLink = linkName.replace(/\.pdf$/i, "");
                } else {
                    var sourceFile = new File(links[i].filePath);
                    if (sourceFile.exists) {
                        var targetFile = new File(state.barcodesFolder.fsName + "/" + sourceFile.name);
                        sourceFile.copy(targetFile);
                        state.currentArticle = sourceFile.name.replace(/\.pdf$/i, "");
                        barcodeFound = true;
                    }
                }
            }
        }

        var warnings = [];
        var successMsgs = [];

        // ОТКАЗОУСТОЙЧИВОСТЬ: Если штрихкод не найден в макете
        if (!barcodeFound || !state.currentArticle) {
            var possibleArtMatch = doc.name.match(/\d{5,}/); 
            var guessedArt = possibleArtMatch ? possibleArtMatch[0] : "";
            
            var manualArt = prompt("Штрихкод не найден в макете!\nЕсли он лежит в папке Barcodes, подтвердите или введите артикул:", guessedArt);
            
            if (manualArt) {
                state.currentArticle = manualArt;
                var checkFile = new File(state.barcodesFolder.fsName + "/" + state.currentArticle + ".pdf");
                if (checkFile.exists) {
                    barcodeFound = true;
                    warnings.push("ШК найден в папке (в макете отсутствовал).");
                } else {
                    warnings.push("ШК ОТСУТСТВУЕТ и в макете, и в папке! Работаем без него.");
                }
            } else {
                statusText.text = "ОШИБКА: Без артикула продолжить невозможно!"; 
                return; // Единственный случай когда прерываемся - юзер отказался ввести артикул
            }
        }

        state.csvRowData = null;
        for (var r=1; r<state.csvData.length; r++) {
            var colArt = state.csvData[r][state.headers.art];
            if (colArt && colArt.replace(/^\s+|\s+$/g, '') === state.currentArticle) {
                state.csvRowData = state.csvData[r]; break;
            }
        }

        // ОТКАЗОУСТОЙЧИВОСТЬ: Если схема не найдена
        if (state.headers.sizeBox !== undefined && state.csvRowData) {
            if (!schemaSizeLink) {
                warnings.push("Схема не найдена! Проверка размера пропущена.");
            } else {
                var csvSizeRaw = state.csvRowData[state.headers.sizeBox];
                var cleanCsvSize = csvSizeRaw.split('(')[0].replace(/[хХ]/g, 'x').replace(/[^0-9x]/g, '');
                var cleanLinkSize = schemaSizeLink.replace(/[хХ]/g, 'x').replace(/[^0-9x]/g, '');
                
                if (cleanCsvSize !== "" && cleanLinkSize !== "") {
                    if (cleanCsvSize !== cleanLinkSize) {
                        warnings.push("РАЗМЕР НЕ СОВПАДАЕТ: Схема " + schemaSizeLink + " | Таблица " + csvSizeRaw);
                    } else {
                        successMsgs.push("Размер совпадает: " + schemaSizeLink);
                    }
                }
            }
        }

        // ОТКАЗОУСТОЙЧИВОСТЬ: Если штрихкод не найден в макете
        var barcodeStatusStr = "";
        var barcodeColor = [0,0,0,1];

        if (!barcodeFound || !state.currentArticle) {
            var possibleArtMatch = doc.name.match(/\d{5,}/); 
            var guessedArt = possibleArtMatch ? possibleArtMatch[0] : "";
            
            var manualArt = prompt("Штрихкод не найден в макете!\nЕсли он лежит в папке Barcodes, подтвердите или введите артикул:", guessedArt);
            
            if (manualArt) {
                state.currentArticle = manualArt;
                var checkFile = new File(state.barcodesFolder.fsName + "/" + state.currentArticle + ".pdf");
                if (checkFile.exists) {
                    barcodeFound = true;
                    barcodeStatusStr = "ШК: В макете нет, но найден в папке (Barcodes).";
                    barcodeColor = [0.8, 0.5, 0.1, 1]; // Оранжевый
                } else {
                    barcodeStatusStr = "ШК: ОТСУТСТВУЕТ (и в макете, и в папке).\nРаботаем без него!";
                    barcodeColor = [0.8, 0.1, 0.1, 1]; // Красный
                }
            } else {
                statusText.text = "ОШИБКА: Без артикула продолжить невозможно!"; 
                return; // Единственный случай когда прерываемся - юзер отказался ввести артикул
            }
        } else {
            barcodeStatusStr = "ШК: Успешно найден в макете (" + state.currentArticle + ").";
            barcodeColor = [0.1, 0.8, 0.2, 1]; // Зеленый
        }

        state.csvRowData = null;
        for (var r=1; r<state.csvData.length; r++) {
            var colArt = state.csvData[r][state.headers.art];
            if (colArt && colArt.replace(/^\s+|\s+$/g, '') === state.currentArticle) {
                state.csvRowData = state.csvData[r]; break;
            }
        }

        // ОТКАЗОУСТОЙЧИВОСТЬ: Если схема не найдена
        var sizeStatusStr = "";
        var sizeColor = [0,0,0,1];

        if (state.headers.sizeBox !== undefined && state.csvRowData) {
            var csvSizeRaw = state.csvRowData[state.headers.sizeBox] || "пусто";
            
            if (!schemaSizeLink) {
                sizeStatusStr = "Схема: НЕ НАЙДЕНА В МАКЕТЕ!\nТаблица: " + csvSizeRaw;
                sizeColor = [0.8, 0.1, 0.1, 1]; // Красный
            } else {
                var cleanCsvSize = csvSizeRaw.split('(')[0].replace(/[хХ]/g, 'x').replace(/[^0-9x]/g, '');
                var cleanLinkSize = schemaSizeLink.replace(/[хХ]/g, 'x').replace(/[^0-9x]/g, '');
                
                if (cleanCsvSize !== "" && cleanLinkSize !== "") {
                    if (cleanCsvSize !== cleanLinkSize) {
                        sizeStatusStr = "РАЗМЕР НЕ СОВПАДАЕТ!\nСхема: " + schemaSizeLink + "\nТаблица: " + csvSizeRaw;
                        sizeColor = [0.8, 0.1, 0.1, 1]; // Красный
                    } else {
                        sizeStatusStr = "Размер совпадает!\nСхема: " + schemaSizeLink + "\nТаблица: " + csvSizeRaw;
                        sizeColor = [0.1, 0.8, 0.2, 1]; // Зеленый
                    }
                } else {
                    sizeStatusStr = "Размер: Ошибка чтения формата.\nСхема: " + schemaSizeLink + "\nТаблица: " + csvSizeRaw;
                    sizeColor = [0.8, 0.5, 0.1, 1]; // Оранжевый
                }
            }
        } else {
             sizeStatusStr = "Размер: В CSV нет данных или не найдена колонка.";
             sizeColor = [0.8, 0.5, 0.1, 1]; // Оранжевый
        }

        // Обновляем окна с отчетами
        txtBarcodeStatus.text = barcodeStatusStr;
        try { txtBarcodeStatus.graphics.foregroundColor = txtBarcodeStatus.graphics.newPen(txtBarcodeStatus.graphics.PenType.SOLID_COLOR, barcodeColor, 1); } catch(e) {}
        
        txtSizeStatus.text = sizeStatusStr;
        try { txtSizeStatus.graphics.foregroundColor = txtSizeStatus.graphics.newPen(txtSizeStatus.graphics.PenType.SOLID_COLOR, sizeColor, 1); } catch(e) {}

        // БРОНЕБОЙНЫЙ СБОР ТЕКСТА СТОРИСОВ
        var allText = "";
        var allStories = doc.stories.everyItem().getElements();
        for (var t = 0; t < allStories.length; t++) {
            allText += allStories[t].contents + "\r\r"; 
        }
        
        var oemMatch = allText.match(/[OО][EЕ][MМ][\s:\xA0]*([\s\S]*?)(?:Комплектация|Производство|Срок|Гарант|Арт\.|\r\r|$)/i);
        if (oemMatch) {
            state.extractedOEM = oemMatch[1].replace(/[\r\n]+/g, ' ').replace(/^\s+|\s+$/g, '');
        } else {
            state.extractedOEM = "ОЕМ НЕ НАЙДЕН";
        }

        var compMatch = allText.match(/Комплектация[\s:\xA0]*([\s\S]*?)(?:Производство|Срок|Гарант|Арт\.|Дата|Изготовитель|Товар|\r\r|$)/i);
        if (compMatch) {
            state.extractedComp = compMatch[1].replace(/[\r\n]+/g, ' ').replace(/^\s+|\s+$/g, '');
        } else {
            state.extractedComp = "КОМПЛЕКТАЦИЯ НЕ НАЙДЕНА";
        }

        var axisMatch = allText.match(/(передние|задние|передняя|задняя)/i);
        if (axisMatch) {
            state.extractedAxis = axisMatch[1];
        } else {
            state.extractedAxis = "";
        }

        statusText.text = "Арт: " + state.currentArticle + " обработан.\nУдалите лишний дизайн и жмите Шаг 2!";
        btnStep2.enabled = true;
        btnStep1.enabled = false;
    };

    btnStep2.onClick = function() {
        if (!state.currentArticle) return;
        var activeBoxDoc = app.activeDocument; 
        
        var artFolder = new Folder(state.outputFolder.fsName + "/" + state.currentArticle + "_2026_NEW");
        if (!artFolder.exists) artFolder.create();

        var templateStickerFile = new File(state.baseFolder.fsName + "/template_sticker.indd");
        if (!templateStickerFile.exists) {
            statusText.text = "ОШИБКА: Нет template_sticker.indd"; return;
        }
        
        var stickerDoc = app.open(templateStickerFile, true); 
        
        // УНИВЕРСАЛЬНАЯ ЗАМЕНА ПО ТЕГАМ TXT_ из таблицы
        if (state.csvRowData) {
            for (var txtTag in state.headers.txtFields) {
                var colIndex = state.headers.txtFields[txtTag];
                var txtValue = state.csvRowData[colIndex] || "";
                replacePlaceholder(stickerDoc, txtTag, txtValue, false);
            }
        }

        replacePlaceholder(stickerDoc, "Item No.", state.currentArticle, false); 
        replacePlaceholder(stickerDoc, "Info_OEM", state.extractedOEM, true); 
        replacePlaceholder(stickerDoc, "axis", state.extractedAxis, false); 
        
        var finalComp = state.extractedComp;
        if (finalComp) {
            finalComp = finalComp.replace(/шт[\.\;]?\s*/gi, "шт; \n").replace(/\s+$/, "");
        }
        replacePlaceholder(stickerDoc, "Info_KP", finalComp, true); 

        // ПЕРЕЛИНКОВКА ШТРИХКОДА В СТИКЕРЕ
        var barcodeFile = new File(state.barcodesFolder.fsName + "/" + state.currentArticle + ".pdf");
        if (barcodeFile.exists) {
            for (var l = stickerDoc.links.length - 1; l >= 0; l--) {
                if (stickerDoc.links[l].name.toLowerCase().indexOf(".pdf") !== -1) {
                    stickerDoc.links[l].relink(barcodeFile);
                    stickerDoc.links[l].update();
                }
            }
        }

        // --- ЖЕЛЕЗОБЕТОННОЕ УПРАВЛЕНИЕ ИКОНКАМИ ОСИ ---
        var axisLower = state.extractedAxis.toLowerCase();
        var iconFront = null;
        var iconRear = null;
        
        var allStickerItems = stickerDoc.allPageItems;
        for (var j = 0; j < allStickerItems.length; j++) {
            try {
                if (allStickerItems[j].name === "Icon_Front") iconFront = allStickerItems[j];
                else if (allStickerItems[j].name === "Icon_Rear") iconRear = allStickerItems[j];
            } catch(e) {}
        }
        
        if (iconFront && iconRear) {
            if (axisLower.indexOf("перед") !== -1) {
                iconFront.visible = true; iconRear.visible = false;
            } else if (axisLower.indexOf("зад") !== -1) {
                iconRear.visible = true; iconFront.visible = false;
            }
        }

        // Сохраняем исходник стикера, чтобы вы могли его править
        var stickerFile = new File(artFolder.fsName + "/" + state.currentArticle + "_sticker_100x80.indd");
        stickerDoc.save(stickerFile);

        // РАБОТА С КОРОБКОЙ (ЦЕНТРОВКА ПО МАТЕМАТИЧЕСКОМУ ЦЕНТРУ СТРАНИЦЫ)
        var templateBoxFile = new File(state.baseFolder.fsName + "/template_box.indd");
        if (templateBoxFile.exists) {
            var boxTempDoc = app.open(templateBoxFile, false);
            var tItems = boxTempDoc.pages[0].pageItems.everyItem().getElements();
            if (tItems.length > 0) {
                app.activeDocument = activeBoxDoc; 
                
                var oldItems = activeBoxDoc.pages[0].pageItems.everyItem().getElements();
                var oldIDs = {};
                for(var o = 0; o < oldItems.length; o++) {
                    oldIDs[oldItems[o].id] = true;
                }

                boxTempDoc.pages[0].pageItems.everyItem().duplicate(activeBoxDoc.pages[0]);
                
                var allNewBoxItems = activeBoxDoc.pages[0].pageItems.everyItem().getElements();
                var newItems = [];
                for(var a = 0; a < allNewBoxItems.length; a++){
                    if(!oldIDs[allNewBoxItems[a].id]) {
                        newItems.push(allNewBoxItems[a]);
                    }
                }
                
                if (newItems.length > 0) {
                    var minX = 999999, minY = 999999, maxX = -999999, maxY = -999999;
                    for(var n = 0; n < newItems.length; n++) {
                        var b = newItems[n].geometricBounds; 
                        if (b[0] < minY) minY = b[0];
                        if (b[1] < minX) minX = b[1];
                        if (b[2] > maxY) maxY = b[2];
                        if (b[3] > maxX) maxX = b[3];
                    }
                    var designCenterX = (minX + maxX) / 2;
                    var designCenterY = (minY + maxY) / 2;
                    
                    var pb = activeBoxDoc.pages[0].bounds; 
                    var pageCenterX = (pb[1] + pb[3]) / 2;
                    var pageCenterY = (pb[0] + pb[2]) / 2;
                    
                    var deltaX = pageCenterX - designCenterX;
                    var deltaY = pageCenterY - designCenterY;
                    
                    for(var m = 0; m < newItems.length; m++) {
                        newItems[m].move(undefined, [deltaX, deltaY]);
                    }
                }
            }
            boxTempDoc.close(SaveOptions.NO);
        }

        // ВАЖНО: Делаем активным окно со стикером для ручных правок
        app.activeDocument = stickerDoc;

        statusText.text = "Стикер сгенерирован!\nПоправьте его вручную и нажмите ШАГ 2.5.";
        btnStep2.enabled = false;
        btnStep2_5.enabled = true; // Активируем новую промежуточную кнопку
    };

    btnStep2_5.onClick = function() {
        if (!state.currentArticle) return;

        // Ищем открытый документ стикера
        var stickerDoc = null;
        for (var i = 0; i < app.documents.length; i++) {
            if (app.documents[i].name.indexOf(state.currentArticle + "_sticker") !== -1) {
                stickerDoc = app.documents[i];
                break;
            }
        }
        if (!stickerDoc) stickerDoc = app.activeDocument; // Fallback

        var artFolder = new Folder(state.outputFolder.fsName + "/" + state.currentArticle + "_2026_NEW");
        var stickerPdfFile = new File(artFolder.fsName + "/" + state.currentArticle + "_sticker_100x80.pdf");

        // 1. Сохраняем и экспортируем PDF стикера после ручных правок
        stickerDoc.save();
        exportPDF(stickerDoc, stickerPdfFile);
        
        // 2. Закрываем вкладку стикера
        stickerDoc.close(SaveOptions.NO);

        // 3. Возвращаемся на вкладку коробки
        var boxDoc = null;
        for (var d = 0; d < app.documents.length; d++) {
            if (app.documents[d].name === state.boxDocName) {
                boxDoc = app.documents[d]; break;
            }
        }
        
        if (boxDoc) {
            app.activeDocument = boxDoc;
            
            // 4. Обновляем прилинкованную PDF стикера в коробке
            for (var bl = boxDoc.links.length - 1; bl >= 0; bl--) {
                var bName = boxDoc.links[bl].name.toLowerCase();
                if (bName.indexOf(".pdf") !== -1 && (bName.indexOf("sticker") !== -1 || bName.indexOf("стикер") !== -1)) {
                    var myLink = boxDoc.links[bl];
                    myLink.relink(stickerPdfFile);
                    myLink.update();
                    try { myLink.parent.parent.bringToFront(); } catch(e) {}
                }
            }
        }

        statusText.text = "Стикер сохранен и обновлен!\nВыровняйте макет и жмите ШАГ 3.";
        btnStep2_5.enabled = false;
        btnStep3.enabled = true;
    };

    btnStep3.onClick = function() {
        if (!state.currentArticle) return;
        var doc = app.activeDocument;
        
        var hasMissingLinks = false;
        for (var i = doc.links.length - 1; i >= 0; i--) {
            var myLink = doc.links[i];
            if (myLink.status === LinkStatus.LINK_OUT_OF_DATE) {
                myLink.update(); 
            } else if (myLink.status === LinkStatus.LINK_MISSING) {
                hasMissingLinks = true;
            }
        }
        
        if (hasMissingLinks) {
            alert("ВНИМАНИЕ!\nНа макете есть 'потерянные' файлы!\n\nСкрипт остановлен. Восстановите связи вручную и нажмите 'ШАГ 3' еще раз.");
            return; 
        }
        
        var artFolder = new Folder(state.outputFolder.fsName + "/" + state.currentArticle + "_2026_NEW");
        var boxFile = new File(artFolder.fsName + "/" + state.currentArticle + "_box_2026.indd");
        var boxPdfFile = new File(artFolder.fsName + "/" + state.currentArticle + "_box_2026.pdf");
        
        doc.save(boxFile);
        exportPDF(doc, boxPdfFile);
        doc.close(SaveOptions.NO);
        
        state.currentArticle = "";
        
        // Сбрасываем панели для следующей коробки
        txtSizeStatus.text = "Размер: Ожидание...";
        txtBarcodeStatus.text = "Штрихкод: Ожидание...";
        try { txtSizeStatus.graphics.foregroundColor = txtSizeStatus.graphics.newPen(txtSizeStatus.graphics.PenType.SOLID_COLOR, [0,0,0,1], 1); } catch(e) {}
        try { txtBarcodeStatus.graphics.foregroundColor = txtBarcodeStatus.graphics.newPen(txtBarcodeStatus.graphics.PenType.SOLID_COLOR, [0,0,0,1], 1); } catch(e) {}
        
        statusText.text = "УСПЕХ! Всё сохранено.\nЖдем следующий старый макет.";
        btnStep3.enabled = false;
        btnStep1.enabled = true;
    };

    win.center();
    win.show();

})();
