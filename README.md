# Convert HEIC+MOV (Apple iPhone Live Photos) to Google Motion Photo

This Node script, based on [this](https://github.com/aviv926/MotionPhotoMuxer-HEIC) script, can convert HEIC + MOV to a single JPG that can be uploaded to Google Photos, retaining the motion data. Personally, I'm interested in doing this so that the photos can be uploaded using a Pixel 1 so that they don't count against the storage limit of the Google account.

## Limitations

By default, the script converts HEIC to JPG that is similiar in quality, but has a much larger file size. It could be reconfigured to reduce the file size, but the resulting JPG would likely be lower quality than the HEIC. The motion portion of the photo is lossless. Additionally, HEIC photos taken on newer iPhones contain 10-bit HDR data that is lost when converting to JPG.

Theoretically, you should be able to create a HEIC file with the video embedded that also contains 10-bit HDR data, as this is what modern Galaxy phones do by default. [This](https://github.com/g0ddest/sm_motion_photo/blob/master/tests/data/photo.heic) is an example of a HEIF with embedded video. But, these don't seem to show motion when uploaded to Google Photos, at least via the web interface. It seems that Google Photos should support Galaxy motion photos, but maybe only when uploaded from the Galaxy phone itself; I'm not sure. If anyone figures out how to embed the MOV into the HEIC in a way that Google Photos will reconize, please let me know!

## Usage

1. Download Node.js and clone this repo
1. Run `npm install`
1. Run `npm start`, and follow the on-screen instructions.
