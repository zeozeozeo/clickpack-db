# ClickpackDB

A database of clickpacks for Geometry Dash clickbots with an easy-to-use API.

## Usage

1. Place your clickpacks in the `db` directory.
2. Run the following command to convert the clickpacks to .ogg files. The converted files will be placed in the `ogg` directory. Note: you need to have FFmpeg installed.
   ```bash
   python3 audio2ogg.py
   ```
3. Finally, execute the following command to generate the `db.json` file. This script will retain the values from the previous `db.json` file if it exists.
   ```bash
   python3 index.py
   ```

## API

**Response Format:** JSON

**Endpoints:**

1. **Endpoint:** `https://raw.githubusercontent.com/zeozeozeo/clickpack-db/main/db.json`
   - **Method:** `GET`
   - **Description:** Fetches ClickpackDB's database file.
   - **Response:** A JSON object with the following structure:
     - `updated_at_iso` (string): The date and time (in ISO format) when the database was last updated.
     - `updated_at_unix` (integer): The date and time (in Unix timestamp format) when the database was last updated.
     - `clickpacks` (object): A collection of clickpacks, where each key is the name of a clickpack and the value is an object with the following properties:
       - `size` (integer): The size of the compressed clickpack file.
       - `uncompressed_size` (integer): The size of the uncompressed clickpack directory.
       - `has_noise` (boolean): A flag indicating whether the clickpack contains a noise file.
       - `url` (string): The URL to download the compressed clickpack file.
       - `checksum` (string): MD5 checksum of the compressed clickpack file.
       - `readme` (string, optional): Contents of any .txt file in the clickpack, if any
     - `version` (integer): unique version of the `db.json` file
