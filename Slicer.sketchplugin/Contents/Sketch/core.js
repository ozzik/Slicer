@import "sketch-nibui.js";
@import "sizes.js";

var SL = {}; // Namespace

/* === Core Slicer === */
SL.Slicer = {
	documentMetadata: null,

	exportToFolder: function(context, isRequestNewConfig) {
		if (!context.selection.count()) { return; }

		SL.Slicer.documentMetadata = context.document.mutableUIMetadata();

		var exportConfig = SL.ExportConfig.get(context, isRequestNewConfig),
			isSuccess;

		if (!exportConfig) { return; }

		isSuccess = SL.Slicer._export(context, exportConfig);

		if (!isSuccess) { return; }

		if (exportConfig.isOpenFolderPostExport) {
			url = NSURL.URLWithString("file://" + exportConfig.directory.replace(/ /g, "%20"));
			NSWorkspace.sharedWorkspace().openURL(url);
		} else {
			context.document.showMessage("All done!");
		}
	},

	_export: function(context, config) {
		var selection = context.selection,
			doc = context.document,
			platforms = { "android": "Android", "ios": "iOS" }, // Fake keys
			isSuccess = true,
			previousShouldFixArtboardBackground,
			previousShouldFixSliceBackground,
			isStop;

		// Each layer
		for (var s = 0; s < selection.count() && !isStop; s++) {
			// Checking for possible background color annoyances
			if (selection[s].class() == MSArtboardGroup && selection[s].class && (!selection[s].includeBackgroundColorInExport() || !selection[s].hasBackgroundColor())) {
				previousShouldFixArtboardBackground = SL.Slicer._tryToFixArtboardBackground(context, selection[s], config, previousShouldFixArtboardBackground);
				isStop = !previousShouldFixArtboardBackground ? true : false;
			} else if (selection[s].class() != MSArtboardGroup && doc.currentPage().currentArtboard() && doc.currentPage().currentArtboard().includeBackgroundColorInExport() && doc.currentPage().currentArtboard().hasBackgroundColor()) {
				previousShouldFixSliceBackground = SL.Slicer._tryToFixSliceBackground(context, selection[s], config, previousShouldFixSliceBackground);
				isStop = !previousShouldFixSliceBackground ? true : false;
			}
			if (isStop) { continue; }

			// Each platform
			for (var platform in platforms) {
				if (!config[platform].length) { continue; }

				config.nestedFolder = (config.android.length && config.ios.length) ? platforms[platform] + "/" : "";

				// Possible 9 patch layer
				if (platform == "android" && selection[s].name().indexOf(".9") == selection[s].name().length() - 2 && selection[s].name().length >= 3) {
					isSuccess &= SL.NinePatch.try(selection[s], context, config);
				} else if (selection[s].class() == "MSSliceLayer") { // Slice
					SL.Slicer._exportSlice(selection[s], platform, config, context);
				} else { // Layer/group
					SL.Slicer._exportLayer(selection[s], platform, config, context);
				}
			}
		}
		isSuccess &= !isStop;

		return isSuccess;
	},

	_exportSlice: function(selection, platform, config, context) {
		var ancestry = MSImmutableLayerAncestry.ancestryWithMSLayer(selection),
			sizeData,
			exportFormat,
			slice,
			fileName;

		for (var i in config[platform]) {
			sizeData = config[platform][i];
			sizeData = _SIZES[platform][sizeData];
			exportFormat = MSExportFormat.formatWithScale_name_fileFormat(sizeData.size, "", "png");

			slice = MSExportRequest.exportRequestsFromLayerAncestry_exportFormats(ancestry, [ exportFormat ])[0];
			SL.Slicer._saveSliceToFile(slice, selection, platform, sizeData, config, context);
		}
	},

	_exportLayer: function(selection, platform, config, context) {
		var slices,
			sizeData,
			exportOption,
			fileName;
			
		var rect = selection.absoluteRect().rect();
			
		for (var i in config[platform]) {
			sizeData = config[platform][i];
			sizeData = _SIZES[platform][sizeData];

			selection.exportOptions().removeAllExportFormats();
			exportOption = selection.exportOptions().addExportFormat();
			exportOption.setName("");
			exportOption.setScale(sizeData.size);
			
			slices = MSExportRequest.exportRequestsFromExportableLayer(selection);
			slices[0].rect = rect;

			SL.Slicer._saveSliceToFile(slices[0], selection, platform, sizeData, config, context);
		}

		selection.exportOptions().removeAllExportFormats();
	},

	_saveSliceToFile: function(slice, selection, platform, sizeData, config, context) {
		var fileName;

		if (platform != "android") {
			fileName = (config.nestedFolder || "") + selection.name() + sizeData.name + ".png";
		} else {
			fileName = (config.nestedFolder || "") + "drawable-" + sizeData.name + "/" + selection.name() + ".png";
		}

		context.document.saveArtboardOrSlice_toFile(slice, (config.directory + fileName));
	},

	_tryToFixArtboardBackground: function(context, artboard, config, previousShouldFix) {
		var shouldFix;

		if (config.isIgnoreArtboardBackground) { return 2; }

		if (!previousShouldFix) {
			shouldFix = SL.UI.showError(context, {
				title: "Did you forget to set a background color to some artboards?",
				message: "If you continue, the exported artboards will have a transparent color.",
				confirmCaption: "Fix and export",
				alternativeCaption: "Export anyway"
			});
		} else {
			shouldFix = previousShouldFix;
		}

		if (shouldFix == 1) {
			artboard.setHasBackgroundColor(true);
			artboard.setIncludeBackgroundColorInExport(true);
		} else if (shouldFix == 2) {
			SL.ExportConfig.setIgnoreArtboardBackground(true);
		}

		return shouldFix;
	},

	_tryToFixSliceBackground: function(context, slice, config, previousShouldFix) {
		var shouldFix;

		if (config.isIgnoreSliceBackground) { return 2; }

		if (!previousShouldFix) {
			shouldFix = SL.UI.showError(context, {
				title: "Heads up: Your slices will have a background color",
				message: "If you continue, your slices will have the background color of their artboard instead of being transparent.",
				confirmCaption: "Fix and export",
				alternativeCaption: "Export anyway"
			});
		} else {
			shouldFix = previousShouldFix;
		}

		if (shouldFix == 1) {
			context.document.currentPage().currentArtboard().setIncludeBackgroundColorInExport(false);
		} else if (shouldFix == 2) {
			SL.ExportConfig.setIgnoreSliceBackground(true);
		}

		return shouldFix;
	}
};

/* === Config === */
SL.ExportConfig = {
	KEY: "Slicer.exportConfig",

	get: function(context, isRequestNewConfig) {
		var config = SL.ExportConfig.getSaved(SL.Slicer.documentMetadata);

		if (!config || isRequestNewConfig) {	
			config = SL.ExportConfig.getNew(context, config);
		}
		
		return config ? SL.ExportConfig._parse(config) : null;
	},

	getSaved: function() {
		var configData = SL.Slicer.documentMetadata[SL.ExportConfig.KEY] || "";

		try {
		    configData = JSON.parse(configData);
		} catch(e) {
		    configData = null;
		}

		return configData;
	},

	getNew: function(context, currentConfig) {
		var config,
			exportDirectory;

		// Getting preset/sizes
		config = SL.ExportConfig._requestPreset(context);
		if (!config) { return; }

		// Getting folder export
		exportDirectory = SL.UI.requestDirectory(context, currentConfig && currentConfig.directory);
		if (!exportDirectory) { return; }

		config.directory = exportDirectory + "/";

		SL.ExportConfig._save(config);

		return config;
	},

	_parse: function(config) {
		var androidSizes = [],
			iosSizes = [];

		if (config.android || config.ios) {
			androidSizes = config.android;
			iosSizes = config.ios;
		} else {
			switch (config.preset) {
				case 0:
					iosSizes = [ 0, 1, 2 ];
					break;
				case 1:
					iosSizes = [ 0, 1 ];
					break;
				case 2:
					androidSizes = [ 0, 1, 2, 3, 4 ];
					break;
				case 3:
					androidSizes = [ 1, 3 ];
					break;
			}
		}

		return {
			directory: config.directory,
			android: androidSizes,
			ios: iosSizes,
			isOpenFolderPostExport: config.isOpenFolderPostExport,
			isIgnoreArtboardBackground: config.isIgnoreArtboardBackground,
			isIgnoreSliceBackground: config.isIgnoreSliceBackground
		};
	},

	_requestPreset: function(context) {
		var alertData = SL.UI.requestConfig(context),
			nibui = alertData.nibui,
			selected = [],
			i = 0,
			config = {};

		if (!alertData.isConfirm) { return; }

		// Detecting config
		if (nibui.tabView.selectedTabViewItem().label() == "Presets") {
			while (i < 4 && !selected.length) {
				nibui["radioPreset" + i].state() && selected.push(i);
				i++;
			}

			config.preset = selected[0];
		} else {
			config.android = [];
			config.ios = [];

			for (var i in _SIZES.android) {
				nibui["checkAndroid" + i].state() && config.android.push(parseInt(i, 10));
			}
			for (var i in _SIZES.ios) {
				nibui["checkIos" + i].state() && config.ios.push(parseInt(i, 10));
			}
		}

		config.isOpenFolderPostExport = nibui.checkOpenFolderPostExport.state();

		nibui.destroy();

		return config;
	},

	_save: function(config) {
		SL.Slicer.documentMetadata[SL.ExportConfig.KEY] = JSON.stringify(config);
	},

	setIgnoreArtboardBackground: function(value) {
		var config = SL.ExportConfig.getSaved();
		config.isIgnoreArtboardBackground = value;
		SL.ExportConfig._save(config);
	},

	setIgnoreSliceBackground: function(value) {
		var config = SL.ExportConfig.getSaved();
		config.isIgnoreSliceBackground = value;
		SL.ExportConfig._save(config);
	}
};

/* === UI === */
SL.UI = {
	requestConfig: function(context) {
		var alert = NSAlert.alloc().init();

		alert.setMessageText("Let's export!");
		alert.setInformativeText("Select a size preset or go make things complicated...");
		alert.addButtonWithTitle("Export");
		alert.addButtonWithTitle("Cancel");
		alert.setIcon(NSImage.alloc().initWithContentsOfFile(context.plugin.urlForResourceNamed("UIBundle/Contents/Resources/icon@2x.png").path()));

		var nibui = new NibUI(context, "UIBundle", "MyNibUI",
			[
				"tabView",
				"radioPreset0", "radioPreset1", "radioPreset2", "radioPreset3",
				"checkIos0", "checkIos1", "checkIos2",
				"checkAndroid0", "checkAndroid1", "checkAndroid2", "checkAndroid3", "checkAndroid4",
				"checkOpenFolderPostExport"
			]
		);

		alert.setAccessoryView(nibui.view);

		// Updating state to saved config
		nibui.tabView.selectTabViewItemAtIndex(1);
		nibui.tabView.selectTabViewItemAtIndex(0);

		nibui.radioPreset0.becomeFirstResponder();

		var alertAction = alert.runModal();

		return {
			nibui: nibui,
			isConfirm: alertAction == NSAlertFirstButtonReturn
		};
	},

	requestDirectory: function(context, latestPath) {
		var panel = NSOpenPanel.openPanel(),
			defaultPath,
			path;

		if (context.document.fileURL() && !latestPath) {
			defaultPath = context.document.fileURL().URLByDeletingLastPathComponent();
		} else {
			defaultPath = NSURL.URLWithString(latestPath || "~/Desktop");
		}

		panel.setDirectoryURL(defaultPath);
		panel.setCanChooseDirectories(true);
		panel.setAllowsMultipleSelection(true);
		panel.setCanCreateDirectories(true);
		panel.setMessage("Select a directory to export to");

		if (panel.runModal() == NSOKButton) {
			path = panel.URL().path();
		}

		return path;
	},

	showError: function(context, options) {
		var alert = NSAlert.alloc().init();

		alert.setMessageText(options.title);
		alert.setInformativeText(options.message);

		options.confirmCaption && alert.addButtonWithTitle(options.confirmCaption);
		options.alternativeCaption && alert.addButtonWithTitle(options.alternativeCaption);
		alert.addButtonWithTitle(options.confirmCaption ? "Cancel" : "Gotcha");

		if (options.image) {
			var imageView = NSImageView.alloc().initWithFrame(NSMakeRect(0, 0, options.imageWidth, options.imageHeight));
			imageView.setImageScaling(NSScaleToFit);
			imageView.setImage(NSImage.alloc().initWithContentsOfFile(context.plugin.urlForResourceNamed("UIBundle/Contents/Resources/" + options.image).path()));
			alert.setAccessoryView(imageView);
		}

		alert.setIcon(NSImage.alloc().initWithContentsOfFile(context.plugin.urlForResourceNamed("UIBundle/Contents/Resources/icon-error@2x.png").path()));

		var alertAction = alert.runModal();

		if (alertAction == NSAlertFirstButtonReturn) {
			return 1
		} else {
			return (options.alternativeCaption && alertAction == NSAlertSecondButtonReturn) ? 2 : 0;
		}
	}
};

/* === 9-Patch === */
SL.NinePatch = {
	try: function(target, context, config) {
		var layers = target.layers(),
			inferData = SL.NinePatch._infer(layers),
			size,
			fileName,
			currentPage,
			tempPage;

		if (!inferData.didFind) {
			SL.UI.showError(context, {
				title: "😱 Can't export \"" + layers[0].parentGroup().name() + "\"",
				message: "Exporting 9-patch works only when the group holds 2 groups: one holding 4 \"patch lines\" and another holding the actual slice content (their names don't really matter).",
				image: "patch-error-structure@2x.gif",
				imageWidth: 270,
				imageHeight: 150
			});
			return;
		}
		// Validating patch sizes for 1.5x
		if (config.android.indexOf(1) != -1 && !SL.NinePatch._validate(context, layers, inferData)) { return; } // Bad patch

		// Dummy holding page
		currentPage = context.document.currentPage();
		tempPage = context.document.addBlankPage();

		for (var i in config.android) {
			size = config.android[i];
			fileName = (config.nestedFolder || "") + "drawable-" + _SIZES.android[size].name + "/" + target.name() + ".png";

			SL.NinePatch._create(target, inferData.iSlice, inferData.iPatch, tempPage, context, _SIZES.android[size].size, fileName, config.directory);
		}
		
		context.document.removePage(tempPage);
		context.document.setCurrentPage(currentPage);

		return true;
	},

	_infer: function(layers) {
		var BLACK = MSColor.blackColor();
		var i = 0,
		    patch,    
		    slice,
		    iPatch = 0,
		    iSlice = 0,
		    currentLayer,
		    subLayers,
		    didFind;

		// Skipping check if layer count is bad
		if (layers.count() != 2) {
			i = 5;
		}

		// Inferring 9patch + slice
		while ((!patch && !slice) && i < 2) {
		    currentLayer = layers.objectAtIndex(i);
		    blackCount = 0;
		    
		    // 9patch
		    if (currentLayer.class() == "MSLayerGroup") {
		        subLayers = currentLayer.layers()
		        for (var s = 0; s < subLayers.count(); s++) {   
		        	if (subLayers.objectAtIndex(s).class() == MSSliceLayer) { continue; }
		            blackCount += (subLayers.objectAtIndex(s).style().fills().objectAtIndex(0).color().isEqual(BLACK)) ? 1 : 0;
		        }
		        
		        if (blackCount == 4) {
		            patch = currentLayer;
		            slice = layers.objectAtIndex(iSlice);
		            iPatch = i;
		            iSlice = i ? 0 : 1;
		            didFind = true;
		        }
		    }
		    
		    i++;
		}

		return {
			iPatch: iPatch,
			iSlice: iSlice,
			didFind: didFind
		};
	},

	_validate: function(context, layers, data) {
		var isValid = true,
			patches = layers[data.iPatch].layers(),
			patchName,
			isHorizontalPatch,
			error,
			frame,
			i = 0,
			sliceName = layers[data.iSlice].parentGroup().name(),
			shouldFix;

		// Slice size
		frame = layers[data.iSlice].frame();
		isValid = (frame.width() % 2 == 0 && frame.height() % 2 == 0);
		
		if (!isValid) {
			SL.UI.showError(context, {
				title: "😱 Can't export \"" + sliceName + "\" at 1.5x",
				message: "The width and height of your slice's content must be even (current size: " + frame.width() + "x" + frame.height() + "). Try stretching your slice or just adding an extra space pixel."
			});
		}

		// Slice sizes
		while (i < patches.count() && isValid) {
			frame = patches[i].frame();
			patchName = SL.NinePatch._detectPatch(frame, layers[data.iSlice]);
			isHorizontalPatch = (patchName == "top" || patchName == "bottom");

			// Width/height
			isValid = isHorizontalPatch ? (frame.width() % 2 == 0) : (frame.height() % 2 == 0);
			if (!isValid) {
				error = "Your " + patchName + " patch's " + (isHorizontalPatch ? "width" : "height") + " should be even ";
				error += "(current is " + (isHorizontalPatch ? frame.width() : frame.height()) + "px).";

				shouldFix = SL.UI.showError(context, {
					title: "😱 Can't export \"" + sliceName + "\" at 1.5x",
					message: error,
					confirmCaption: "Fix and continue",
					image: "patch-error-" + patchName + "@2x.png",
					imageWidth: 134,
					imageHeight: 98
				});

				if (shouldFix) {
					SL.NinePatch._fixSize(patches[i], isHorizontalPatch);
					isValid = true;
				} else {
					i = patches.count(); // Stopping
				}
			} else { // Verifying padding
				isValid = isHorizontalPatch ? ((frame.x() - layers[data.iSlice].frame().x()) % 2 == 0) : ((frame.y() - layers[data.iSlice].frame().y()) % 2 == 0);

				if (!isValid) {
					error = "Your " + patchName + " patch's padding should be even ";
					error += "(current is " + (isHorizontalPatch ? (frame.x() - layers[data.iSlice].frame().x()) : (frame.y() - layers[data.iSlice].frame().y())) + "px).";
					shouldFix = SL.UI.showError(context, {
						title: "😱 Can't export \"" + sliceName + "\" at 1.5x",
						message: error,
						confirmCaption: "Fix and continue",
						image: "patch-error-" + patchName + "-padding@2x.png",
						imageWidth: 134,
						imageHeight: 98
					});

					if (shouldFix) {
						SL.NinePatch._fixPadding(patches[i], isHorizontalPatch);
						isValid = true;
					} else {
						i = patches.count(); // Stopping
					}

				} else {
					i++;
				}
			}
		}

		return isValid;
	},

	_fixPadding: function(patch, isHorizontalPatch) {
		if (isHorizontalPatch) {
			patch.frame().setX(patch.frame().x() - 1);
		} else {
			patch.frame().setY(patch.frame().y() - 1);
		}
	},

	_fixSize: function(patch, isHorizontalPatch) {
		if (isHorizontalPatch) {
			patch.frame().setWidth(patch.frame().width() > 1 ? (patch.frame().width() + 1) : 2);
		} else {
			patch.frame().setHeight(patch.frame().height() > 1 ? (patch.frame().height() + 1) : 2);
		}
	},

	_detectPatch: function(curPatch, slice) {
		var patch = "";

		if (curPatch.x() >= slice.frame().x() && curPatch.x() < slice.frame().x() + slice.frame().width()) {
			patch = (curPatch.y() < slice.frame().y()) ? "top" : "bottom";
		} else {
			patch = (curPatch.x() < slice.frame().x()) ? "left" : "right";
		}

		return patch;
	},

	_create: function(target, iSlice, iPatch, tempPage, context, factor, fileName, exportPath) {
		var ditto = target.duplicate(),
			dittoSliceOriginalX,
			dittoSliceOriginalY;
		
		ditto.parentGroup().removeLayer(ditto);
		tempPage.addLayers([ditto]);

		ditto.frame().setX(ditto.frame().x() + ditto.frame().width() + 10);
		ditto.frame().setY(ditto.frame().y());

		var dittoPatch = ditto.layers().objectAtIndex(iPatch),
			dittoSlice = ditto.layers().objectAtIndex(iSlice),
			dittoPatchLayers = dittoPatch.layers(),
			curPatch;

		for (var i = 0; i < dittoPatchLayers.count(); i++) {
			curPatch = dittoPatchLayers.objectAtIndex(i).frame();

			// Top/bottom
			if (curPatch.x() >= dittoSlice.frame().x() && curPatch.x() < dittoSlice.frame().x() + dittoSlice.frame().width()) {
				curPatch.setWidth(curPatch.width() * factor);
				curPatch.setX((curPatch.x() - 1) * factor + 1);

				if (curPatch.y() > dittoSlice.frame().y()) {
					curPatch.setY((curPatch.y() - 1) * factor + 1);
				}
			} else { // Left/right
				curPatch.setHeight(curPatch.height() * factor);
				curPatch.setY((curPatch.y() - 1) * factor + 1);

				if (curPatch.x() > dittoSlice.frame().x()) {
					curPatch.setX((curPatch.x() - 1) * factor + 1);
				}
			}
		}

		dittoSliceOriginalX = dittoSlice.frame().x();
		dittoSliceOriginalY = dittoSlice.frame().y();

		dittoSlice.multiplyBy(factor);
		dittoSlice.makeRectIntegral();
		dittoSlice.frame().setX(dittoSliceOriginalX);
		dittoSlice.frame().setY(dittoSliceOriginalY);

		dittoPatch.resizeToFitChildrenWithOption(0);
		ditto.resizeToFitChildrenWithOption(0);

		var ancestry = MSImmutableLayerAncestry.ancestryWithMSLayer(ditto),
			exportFormat = MSExportFormat.formatWithScale_name_fileFormat(1, "", "png");
			slice = MSExportRequest.exportRequestsFromLayerAncestry_exportFormats(ancestry, [ exportFormat ])[0];

		context.document.saveArtboardOrSlice_toFile(slice, exportPath + fileName);

		tempPage.removeLayer(ditto);
	}
};