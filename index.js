// Import modules
const fs = require("fs");
const path = require("path");
const exiftool = require("exiftool-vendored");
const { ExifTool } = require("exiftool-vendored");
const exiftoolProcess = new ExifTool({ taskTimeoutMillis: 5000 });
const yargs = require("yargs");

// Define functions
const validateDirectory = (dir) => {
	// Check if the directory exists and is a directory
	if (!fs.existsSync(dir)) {
		console.error(`Path doesn't exist: ${dir}`);
		process.exit(1);
	}
	if (!fs.lstatSync(dir).isDirectory()) {
		console.error(`Path is not a directory: ${dir}`);
		process.exit(1);
	}
};

const validateMedia = (photoPath, videoPath) => {
	// Check if the files are valid inputs. Currently the only supported inputs are MP4/MOV and JPEG filetypes.
	// Currently it only checks file extensions instead of actually checking file formats via file signature bytes.
	// Returns true if photo and video files are valid, else false
	if (!fs.existsSync(photoPath)) {
		console.error(`Photo does not exist: ${photoPath}`);
		return false;
	}
	if (!fs.existsSync(videoPath)) {
		console.error(`Video does not exist: ${videoPath}`);
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
		console.error(`Video isn't a MOV or MP4: ${photoPath}`);
		return false;
	}
	return true;
};

const mergeFiles = (photoPath, videoPath, outputPath) => {
	// Merges the photo and video file together by concatenating the video at the end of the photo. Writes the output to
	// a temporary folder.
	// Returns the file name of the merged output file
	console.log(`Merging ${photoPath} and ${videoPath}.`);
	const outPath = path.join(outputPath, path.basename(photoPath));
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	const outfile = fs.createWriteStream(outPath);
	const photo = fs.createReadStream(photoPath);
	const video = fs.createReadStream(videoPath);
	photo.pipe(outfile, { end: false });
	photo.on("end", () => {
		video.pipe(outfile);
	});
	console.log(`Merged photo and video.`);
	return outPath;
};

const addXmpMetadata = async (mergedFile, offset) => {
	// Adds XMP metadata to the merged image indicating the byte offset in the file where the video begins.
	console.log(`Reading existing metadata from file.`);
	const metadata = await exiftoolProcess.read(mergedFile);
	console.log(`Found XMP keys: ${Object.keys(metadata)}`);
	if (Object.keys(metadata).length > 0) {
		console.warn(
			`Found existing XMP keys. They *may* be affected after this process.`
		);
	}

	// exiftool-vendored automatically registers the GCamera namespace, so no need to do it manually
	metadata["Xmp.GCamera.MicroVideo"] = 1;
	metadata["Xmp.GCamera.MicroVideoVersion"] = 1;
	metadata["Xmp.GCamera.MicroVideoOffset"] = offset;
	metadata["Xmp.GCamera.MicroVideoPresentationTimestampUs"] = 1500000; // in Apple Live Photos, the chosen photo is 1.5s after the start of the video, so 1500000 microseconds
	await exiftoolProcess.write(mergedFile, metadata);
};

const convert = async (photoPath, videoPath, outputPath) => {
	// Performs the conversion process to mux the files together into a Google Motion Photo.
	// Returns true if conversion was successful, else false
	const merged = mergeFiles(photoPath, videoPath, outputPath);
	const photoFilesize = fs.statSync(photoPath).size;
	const mergedFilesize = fs.statSync(merged).size;

	// The 'offset' field in the XMP metadata should be the offset (in bytes) from the end of the file to the part
	// where the video portion of the merged file begins. In other words, merged size - photo_only_size = offset.
	const offset = mergedFilesize - photoFilesize;
	await addXmpMetadata(merged, offset);
};

const matchingVideo = (photoPath) => {
	// Returns the matching video file for the given photo file, or an empty string if none is found
	const { dir, name } = path.parse(photoPath);
	const base = `./${dir}/${name}`;
	console.log(path.parse(photoPath));
	console.log(`Looking for videos named: ${base}`);
	if (fs.existsSync(base + ".mov")) {
		return base + ".mov";
	}
	if (fs.existsSync(base + ".mp4")) {
		return base + ".mp4";
	}
	if (fs.existsSync(base + ".MOV")) {
		return base + ".MOV";
	}
	if (fs.existsSync(base + ".MP4")) {
		return base + ".MP4";
	}
	return "";
};

const processDirectory = async (fileDir, recurse) => {
	// Loops through files in the specified directory and generates a list of (photo, video) path tuples that can
	// be converted
	// TODO: Implement recursive scan
	// Returns a list of tuples containing matched photo/video pairs.
	console.log(`Processing dir: ${fileDir}`);
	if (recurse) {
		console.error(`Recursive traversal is not implemented yet.`);
		process.exit(1);
	}

	const filePairs = [];
	for (const file of fs.readdirSync(fileDir)) {
		const fileFullpath = path.join(fileDir, file);
		if (
			(fs.lstatSync(fileFullpath).isFile() &&
				file.toLowerCase().endsWith(".jpg")) ||
			file.toLowerCase().endsWith(".jpeg")
		) {
			const videoFile = matchingVideo(fileFullpath);
			if (videoFile !== "") {
				filePairs.push([fileFullpath, videoFile]);
			}
		}
	}

	console.log(`Found ${filePairs.length} pairs.`);
	console.log(
		`subset of found image/video pairs: ${JSON.stringify(
			filePairs.slice(0, 9)
		)}`
	);
	return filePairs;
};

const main = async (args) => {
	const outdir = args.output || "output";

	if (args.dir) {
		validateDirectory(args.dir);
		const pairs = await processDirectory(args.dir, args.recurse);
		const processedFiles = new Set();
		for (const pair of pairs) {
			if (validateMedia(pair[0], pair[1])) {
				await convert(pair[0], pair[1], outdir);
				processedFiles.add(pair[0]);
				processedFiles.add(pair[1]);
			}
		}

		if (args.copyall) {
			// Copy the remaining files to outdir
			const allFiles = new Set(
				fs.readdirSync(args.dir).map((file) => path.join(args.dir, file))
			);
			const remainingFiles = new Set(
				[...allFiles].filter((file) => !processedFiles.has(file))
			);

			console.log(
				`Found ${remainingFiles.size} remaining files that will copied.`
			);

			if (remainingFiles.size > 0) {
				// Ensure the destination directory exists
				fs.mkdirSync(outdir, { recursive: true });

				for (const file of remainingFiles) {
					const fileName = path.basename(file);
					const destinationPath = path.join(outdir, fileName);
					fs.copyFileSync(file, destinationPath);
				}
			}
		}
	} else {
		if (!args.photo && !args.video) {
			console.error(`Either --dir or --photo and --video are required.`);
			process.exit(1);
		}

		if ((args.photo && !args.video) || (!args.photo && args.video)) {
			console.error(`Both --photo and --video must be provided.`);
			process.exit(1);
		}

		if (validateMedia(args.photo, args.video)) {
			await convert(args.photo, args.video, outdir);
		}
	}
};

// Parse command line arguments
const argv = yargs
	.option("verbose", {
		alias: "v",
		type: "boolean",
		description: "Show logging messages.",
		default: false,
	})
	.option("dir", {
		alias: "d",
		type: "string",
		description:
			"Process a directory for photos/videos. Takes precedence over --photo/--video",
	})
	.option("recurse", {
		alias: "r",
		type: "boolean",
		description:
			"Recursively process a directory. Only applies if --dir is also provided",
		default: false,
	})
	.option("photo", {
		alias: "p",
		type: "string",
		description: "Path to the JPEG photo to add.",
	})
	.option("video", {
		alias: "v",
		type: "string",
		description: "Path to the MOV video to add.",
	})
	.option("output", {
		alias: "o",
		type: "string",
		description: "Path to where files should be written out to.",
	})
	.option("copyall", {
		alias: "c",
		type: "boolean",
		description: "Copy unpaired files to directory.",
		default: false,
	})
	.help()
	.alias("help", "h").argv;

main(argv);
