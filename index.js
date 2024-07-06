const fs = require("fs");
const path = require("path");
const exiftool = require("exiftool-vendored").exiftool;
const readline = require("readline");
const heicconvert = require("heic-jpg-exif");
const { promisify } = require("util");

const problematicFiles = [];
const processedFiles = [];

const validateDirectory = (dir) => {
	if (!dir) {
		console.error("No directory path provided.");
		return false;
	}
	if (!fs.existsSync(dir)) {
		console.error(`Directory does not exist: ${dir}`);
		return false;
	}
	if (!fs.lstatSync(dir).isDirectory()) {
		console.error(`Path is not a directory: ${dir}`);
		return false;
	}
	return true;
};

const validateFile = (filePath) => {
	if (!filePath) {
		console.error("No file path provided.");
		return false;
	}
	if (!fs.existsSync(filePath)) {
		console.error(`File does not exist: ${filePath}`);
		return false;
	}
	return true;
};

const convertHeicToJpeg = async (heicPath) => {
	console.log(`Converting HEIC file to JPEG: ${heicPath}`);
	try {
		const jpegPath = `${path.parse(heicPath).name}.jpg`;
		await heicconvert(heicPath, jpegPath, 1);
		console.log(`HEIC file converted to JPEG: ${jpegPath}`);

		processedFiles.push(heicPath);
		return jpegPath;
	} catch (error) {
		console.warn(`Error converting HEIC file: ${heicPath}: ${error.message}`);
		problematicFiles.push(heicPath);
		return null;
	}
};

const validateMedia = (photoPath, videoPath) => {
	if (!validateFile(photoPath)) {
		console.error("Invalid photo path.");
		return false;
	}
	if (!validateFile(videoPath)) {
		console.error("Invalid video path.");
		return false;
	}
	if (
		!photoPath.toLowerCase().endsWith(".jpg") &&
		!photoPath.toLowerCase().endsWith(".jpeg")
	) {
		console.error(`Photo isn't a JPEG: ${photoPath}`);
		return false;
	}
	if (
		!videoPath.toLowerCase().endsWith(".mov") &&
		!videoPath.toLowerCase().endsWith(".mp4")
	) {
		console.error(`Video isn't a MOV or MP4: ${videoPath}`);
		return false;
	}
	return true;
};

const mergeFiles = (photoPath, videoPath, outputPath) => {
	console.log(`Merging ${photoPath} and ${videoPath}.`);
	const outPath = path.join(outputPath, path.basename(photoPath));
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	const photoData = fs.readFileSync(photoPath);
	const videoData = fs.readFileSync(videoPath);
	fs.writeFileSync(outPath, Buffer.concat([photoData, videoData]));
	processedFiles.push(photoPath, videoPath);
	return outPath;
};

const addXmpMetadata = async (mergedFile, offset) => {
	// the original python script does this:
	// pyexiv2.xmp.register_namespace('http://ns.google.com/photos/1.0/camera/', 'GCamera')
	// but idk how to do that in js and it seems to work without it
	await exiftool.write(mergedFile, {
		"XMP:MicroVideo": 1,
		"XMP:MicroVideoVersion": 1,
		"XMP:MicroVideoOffset": offset,
		"XMP:MicroVideoPresentationTimestampUs": 1500000,
	});

	try {
		await promisify(fs.unlink)(`${mergedFile}_original`);
	} catch (error) {
		console.warn("Failed to delete", error);
	}
};

const createMotionPhoto = async (photoPath, videoPath, outputPath) => {
	if (!validateMedia(photoPath, videoPath)) {
		console.error("Invalid photo or video path.");
		return;
	}
	const merged = mergeFiles(photoPath, videoPath, outputPath);
	const photoFilesize = fs.statSync(photoPath).size;
	const mergedFilesize = fs.statSync(merged).size;
	const offset = mergedFilesize - photoFilesize;
	await addXmpMetadata(merged, offset);
};

const matchingVideo = (photoPath, videoDir) => {
	const base = path.parse(photoPath).name;
	const files = fs.readdirSync(videoDir);
	for (const file of files) {
		if (
			file.startsWith(base) &&
			(file.toLowerCase().endsWith(".mov") ||
				file.toLowerCase().endsWith(".mp4"))
		) {
			return path.join(videoDir, file);
		}
	}
	return null;
};

const uniquePath = (destination, filename) => {
	const { name, ext } = path.parse(filename);
	let counter = 1;
	let newFilename = filename;
	while (fs.existsSync(path.join(destination, newFilename))) {
		newFilename = `${name}(${counter})${ext}`;
		counter++;
	}
	return path.join(destination, newFilename);
};

const processDirectory = async (
	inputDir,
	outputDir,
	moveOtherImages,
	convertAllHeic,
	deleteConverted
) => {
	console.log(`Processing files in: ${inputDir}`);

	if (!validateDirectory(inputDir)) {
		console.error("Invalid input directory.");
		process.exit(1);
	}

	if (!validateDirectory(outputDir)) {
		console.error("Invalid output directory.");
		process.exit(1);
	}

	let matchingPairs = 0;
	const files = fs.readdirSync(inputDir);
	for (const file of files) {
		const filePath = path.join(inputDir, file);
		if (file.toLowerCase().endsWith(".heic")) {
			if (convertAllHeic || matchingVideo(filePath, inputDir)) {
				const jpegPath = await convertHeicToJpeg(filePath);
				if (jpegPath) {
					const videoPath = matchingVideo(jpegPath, inputDir);
					if (videoPath) {
						await createMotionPhoto(jpegPath, videoPath, outputDir);
						matchingPairs++;

						// delete intermediary jpg
						fs.unlinkSync(jpegPath);
					}
				}
				if (deleteConverted && fs.existsSync(filePath)) {
					try {
						fs.unlinkSync(filePath);
						console.log(`Deleted converted HEIC file: ${filePath}`);
					} catch (error) {
						console.warn(`Failed to delete file ${filePath}: ${error.message}`);
					}
				}
			}
		} else if (
			file.toLowerCase().endsWith(".jpg") ||
			file.toLowerCase().endsWith(".jpeg")
		) {
			const videoPath = matchingVideo(filePath, inputDir);
			if (videoPath) {
				await createMotionPhoto(filePath, videoPath, outputDir);
				matchingPairs++;
			}
		}
	}

	console.log("Conversion complete.");
	console.log(`Found ${matchingPairs} matching HEIC/JPEG and MOV/MP4 pairs.`);

	if (moveOtherImages) {
		const otherFilesDir = path.join(outputDir, "other_files");
		fs.mkdirSync(otherFilesDir, { recursive: true });
		for (const file of files) {
			const filePath = path.join(inputDir, file);
			if (
				[".heic", ".jpg", ".jpeg", ".mov", ".mp4", ".png", ".gif"].includes(
					path.extname(file).toLowerCase()
				)
			) {
				if (!processedFiles.includes(filePath)) {
					const uniqueFilePath = uniquePath(
						otherFilesDir,
						path.basename(filePath)
					);
					fs.renameSync(filePath, uniqueFilePath);
					console.log(
						`Moved ${path.basename(uniqueFilePath)} to output directory.`
					);
				}
			}
		}
	}

	console.log("Cleanup complete.");
};

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

const prompt = (query) =>
	new Promise((resolve) => rl.question(`${query}\n`, resolve));

const main = async () => {
	console.log(
		"Welcome to the Apple Live Photos to Google Motion Photos converter.\n"
	);

	const inputDir =
		(
			await prompt(
				"Enter the directory path containing HEIC/JPEG/MOV/MP4 files in the same folder or subfolders (default is 'photos'): "
			)
		).trim() || "photos";

	if (!validateDirectory(inputDir)) {
		console.error("Invalid directory path.");
		process.exit(1);
	}

	const outputDir =
		(
			await prompt("Enter the output directory path (default is 'output'): ")
		).trim() || "output";

	const moveOtherImagesStr = (
		await prompt(
			"Do you want to move non-matching files to the 'other_files' folder in the output directory? (y/n, default is 'n'): "
		)
	)
		.trim()
		.toLowerCase();
	const moveOtherImages = moveOtherImagesStr === "y";

	const convertAllHeicStr = (
		await prompt(
			"Do you want to convert all HEIC files to JPEG, regardless of whether they have a matching MOV/MP4 file? (y/n, default is 'n'): "
		)
	)
		.trim()
		.toLowerCase();
	const convertAllHeic = convertAllHeicStr === "y";

	const deleteConvertedStr = (
		await prompt(
			"Do you want to delete converted HEIC files whether they have a matching MOV/MP4 file or not? (y/n, default is 'n'): "
		)
	)
		.trim()
		.toLowerCase();
	const deleteConverted = deleteConvertedStr === "y";

	await processDirectory(
		inputDir,
		outputDir,
		moveOtherImages,
		convertAllHeic,
		deleteConverted
	);

	if (problematicFiles.length > 0) {
		console.warn("The following files encountered errors during conversion:");
		for (const filePath of problematicFiles) {
			console.warn(filePath);
		}

		fs.writeFileSync(
			"problematic_files.txt",
			`The following files encountered errors during conversion:\n${problematicFiles.join(
				"\n"
			)}`
		);
	}

	rl.close();

	process.exit(0);
};

main();
