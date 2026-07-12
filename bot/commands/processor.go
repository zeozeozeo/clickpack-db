package commands

import (
	"archive/zip"
	"bytes"
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	indexSrcDir  = "ogg"
	indexDstDir  = "out"
	indexDBFile  = "db.json"
	indexDBInput = "db"
	baseURL      = "https://github.com/zeozeozeo/clickpack-db/raw/main/out/"
	hiatusURL    = "https://hiatus.ruikasa.lol"
)

var (
	audioExtensions = map[string]struct{}{
		".mp3": {}, ".wav": {}, ".aiff": {}, ".flac": {}, ".aac": {},
		".wma": {}, ".m4a": {}, ".amr": {}, ".3gp": {},
	}
	// soundExtensions are the file extensions that count as a "sound" in a
	// clickpack. This includes .ogg because the indexer converts all audio to
	// .ogg before packaging.
	soundExtensions = map[string]struct{}{
		".ogg": {}, ".mp3": {}, ".wav": {}, ".aiff": {}, ".flac": {},
		".aac": {}, ".wma": {}, ".m4a": {}, ".amr": {}, ".3gp": {},
	}
	processorArchiveExtensions = []string{".zip", ".rar", ".7z"}
	noiseFiles                 = []string{"noise", "whitenoise", "pcnoise", "background", "silence"}
	reproZipTime               = time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	nowFunc                    = func() time.Time { return time.Now().UTC() }
)

func processClickpacks(root string) error {
	if err := extractArchives(filepath.Join(root, indexDBInput)); err != nil {
		return err
	}
	if err := convertAudioTree(filepath.Join(root, indexDBInput), filepath.Join(root, indexSrcDir)); err != nil {
		return err
	}
	return indexClickpacks(root)
}

func extractArchives(srcDir string) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("failed to read db directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if !isProcessorArchive(ext) {
			continue
		}

		archivePath := filepath.Join(srcDir, name)
		fileNames, err := listArchiveFiles(archivePath, ext)
		if err != nil {
			return err
		}
		slog.Info("extracting archive", "path", archivePath)

		hasSingleRoot, rootDirName := analyzeArchiveStructure(fileNames)
		newRootDir := strings.TrimSuffix(name, filepath.Ext(name))
		if hasSingleRoot {
			if err := extractArchiveTo(archivePath, ext, srcDir); err != nil {
				return err
			}
			oldRootPath := filepath.Join(srcDir, filepath.FromSlash(rootDirName))
			newRootPath := filepath.Join(srcDir, newRootDir)
			if oldRootPath != newRootPath {
				if err := os.RemoveAll(newRootPath); err != nil {
					return fmt.Errorf("failed to remove existing extracted directory: %w", err)
				}
				if err := os.Rename(oldRootPath, newRootPath); err != nil {
					return fmt.Errorf("failed to rename extracted root %q to %q: %w", oldRootPath, newRootPath, err)
				}
			}
			continue
		}

		extractPath := filepath.Join(srcDir, newRootDir)
		if err := os.MkdirAll(extractPath, 0755); err != nil {
			return fmt.Errorf("failed to create extract directory: %w", err)
		}
		if err := extractArchiveTo(archivePath, ext, extractPath); err != nil {
			return err
		}
	}
	return nil
}

func isProcessorArchive(ext string) bool {
	for _, candidate := range processorArchiveExtensions {
		if ext == candidate {
			return true
		}
	}
	return false
}

func listArchiveFiles(archivePath, ext string) ([]string, error) {
	if ext == ".zip" {
		zr, err := zip.OpenReader(archivePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open zip %q: %w", archivePath, err)
		}
		defer zr.Close()
		names := make([]string, 0, len(zr.File))
		for _, f := range zr.File {
			names = append(names, f.Name)
		}
		return names, nil
	}

	if ext == ".rar" {
		if names, err := runUnrarList(archivePath); err == nil {
			return names, nil
		} else {
			slog.Warn("unrar list failed, falling back to 7z", "err", err)
		}
	}
	return run7zList(archivePath)
}

func runUnrarList(archivePath string) ([]string, error) {
	cmd := exec.Command("unrar", "lb", archivePath)
	out, err := cmd.Output()
	if err != nil {
		return nil, commandError("failed to list rar archive", cmd, err)
	}
	return splitArchiveList(out), nil
}

func run7zList(archivePath string) ([]string, error) {
	cmd := exec.Command("7z", "l", "-slt", archivePath)
	out, err := cmd.Output()
	if err != nil {
		return nil, commandError("failed to list archive", cmd, err)
	}

	var names []string
	var currentPath string
	currentIsFolder := false
	flush := func() {
		if currentPath != "" && currentPath != archivePath && !currentIsFolder {
			names = append(names, filepath.ToSlash(currentPath))
		}
		currentPath = ""
		currentIsFolder = false
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, "Path = ") {
			currentPath = strings.TrimPrefix(line, "Path = ")
		} else if strings.HasPrefix(line, "Folder = ") {
			currentIsFolder = strings.TrimPrefix(line, "Folder = ") == "+"
		}
	}
	flush()
	return names, nil
}

func splitArchiveList(out []byte) []string {
	lines := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")
	names := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			names = append(names, filepath.ToSlash(line))
		}
	}
	return names
}

func analyzeArchiveStructure(fileNames []string) (bool, string) {
	topLevel := map[string]struct{}{}
	for _, name := range fileNames {
		name = strings.ReplaceAll(name, "\\", "/")
		parts := strings.Split(name, "/")
		if parts[0] != "" {
			topLevel[parts[0]] = struct{}{}
		}
	}
	if len(topLevel) != 1 {
		return false, ""
	}
	var root string
	for k := range topLevel {
		root = k
	}
	prefix := root + "/"
	for _, name := range fileNames {
		if strings.HasPrefix(strings.ReplaceAll(name, "\\", "/"), prefix) {
			return true, root
		}
	}
	return false, ""
}

func extractArchiveTo(archivePath, ext, dst string) error {
	if ext == ".rar" {
		cmd := exec.Command("unrar", "x", "-o+", archivePath, dst+string(os.PathSeparator))
		if err := cmd.Run(); err == nil {
			return nil
		} else {
			slog.Warn("unrar extract failed, falling back to 7z", "err", err)
		}
	}
	cmd := exec.Command("7z", "x", "-y", "-o"+dst, archivePath)
	if err := cmd.Run(); err != nil {
		return commandError("failed to extract archive", cmd, err)
	}
	return nil
}

func convertAudioTree(srcDir, outDir string) error {
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("failed to create ogg directory: %w", err)
	}
	return filepath.WalkDir(srcDir, func(srcPath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}

		rel, err := filepath.Rel(srcDir, srcPath)
		if err != nil {
			return err
		}
		outPath := filepath.Join(outDir, rel)
		if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
			return fmt.Errorf("failed to create output directory: %w", err)
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if _, ok := audioExtensions[ext]; ok {
			outPath = strings.TrimSuffix(outPath, filepath.Ext(outPath)) + ".ogg"
			if _, err := os.Stat(outPath); err == nil {
				slog.Info("skipping existing converted file", "path", outPath)
				return nil
			}
			return convertToOgg(srcPath, outPath)
		}
		if hasPythonArchiveSuffix(d.Name()) {
			return nil
		}
		return copyFile(srcPath, outPath)
	})
}

func hasPythonArchiveSuffix(name string) bool {
	for _, ext := range processorArchiveExtensions {
		if strings.HasSuffix(name, ext) {
			return true
		}
	}
	return false
}

func convertToOgg(srcPath, outPath string) error {
	slog.Info("converting audio", "src", srcPath, "dst", outPath)
	cmd := exec.Command("ffmpeg", "-i", srcPath, "-y", "-flags", "bitexact", "-acodec", "libvorbis", outPath)
	if err := cmd.Run(); err != nil {
		return commandError("failed to convert audio with ffmpeg", cmd, err)
	}
	return nil
}

func copyFile(srcPath, outPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return err
	}
	info, err := src.Stat()
	if err == nil {
		_ = os.Chtimes(outPath, info.ModTime(), info.ModTime())
	}
	return nil
}

func indexClickpacks(root string) error {
	srcDir := filepath.Join(root, indexSrcDir)
	dstDir := filepath.Join(root, indexDstDir)
	dbPath := filepath.Join(root, indexDBFile)

	db, err := loadOrderedDB(dbPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("failed to create out directory: %w", err)
	}

	for _, name := range db.clickpackNames() {
		entry := db.clickpack(name)
		entry.set("url", stringValue(baseURL+url.PathEscape(name)+".zip"))
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			entries = nil
		} else {
			return fmt.Errorf("failed to read ogg directory: %w", err)
		}
	}

	existingSizes := db.uncompressedSizes()
	var newZips []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirName := entry.Name()
		if db.hasClickpack(dirName) {
			slog.Warn("skipping clickpack already in database", "name", dirName)
			continue
		}

		dirPath := filepath.Join(srcDir, dirName)
		initialSize, hasNoise, readme, soundCount, err := getClickpackInfo(dirPath)
		if err != nil {
			return err
		}
		if existingSizes[initialSize] {
			slog.Info("skipping duplicate clickpack", "name", dirName, "uncompressed_size", initialSize)
			continue
		}

		zipPath := filepath.Join(dstDir, dirName+".zip")
		if err := writeReproZip(dirPath, zipPath); err != nil {
			return err
		}
		finalInfo, err := os.Stat(zipPath)
		if err != nil {
			return err
		}
		checksum, err := md5File(zipPath)
		if err != nil {
			return err
		}

		now := nowFunc()
		newEntry := orderedObject{
			members: []orderedMember{
				{key: "size", value: numberValue(strconv.FormatInt(finalInfo.Size(), 10))},
				{key: "uncompressed_size", value: numberValue(strconv.FormatInt(initialSize, 10))},
				{key: "sound_count", value: numberValue(strconv.FormatInt(int64(soundCount), 10))},
				{key: "has_noise", value: boolValue(hasNoise)},
				{key: "url", value: stringValue(baseURL + url.PathEscape(dirName) + ".zip")},
				{key: "added_at", value: stringValue(pythonISOFormat(now))},
			},
		}
		if readme != "" {
			newEntry.members = append(newEntry.members, orderedMember{key: "readme", value: stringValue(readme)})
		}
		newEntry.members = append(newEntry.members, orderedMember{key: "checksum", value: stringValue(checksum)})
		db.setClickpack(dirName, &newEntry)
		existingSizes[initialSize] = true
		newZips = append(newZips, dirName)
	}

	db.sortClickpacks()
	if len(newZips) > 0 {
		now := nowFunc()
		db.setTop("updated_at_iso", stringValue(pythonISOFormat(now)))
		db.setTop("updated_at_unix", numberValue(strconv.FormatInt(int64(now.Unix()), 10)))
		db.setTop("version", numberValue(strconv.FormatInt(db.version()+1, 10)))
	}
	db.setTop("hiatus", stringValue(hiatusURL))
	return db.write(dbPath)
}

// cleanupCommittedClickpack removes the source archive file and its extracted
// directory from the db input directory after a clickpack has been committed,
// so they are not reprocessed on the next run.
func cleanupCommittedClickpack(name string) {
	root, err := repoRoot()
	if err != nil {
		slog.Warn("failed to resolve repo root for cleanup", "err", err)
		return
	}
	dbDir := filepath.Join(root, indexDBInput)

	// remove the extracted directory produced by extractArchives
	if err := os.RemoveAll(filepath.Join(dbDir, name)); err != nil {
		slog.Warn("failed to remove extracted clickpack directory", "name", name, "err", err)
	}

	// remove the original archive file for any known archive extension
	for _, ext := range archiveExtensions {
		archivePath := filepath.Join(dbDir, name+ext)
		if err := os.Remove(archivePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("failed to remove clickpack archive", "path", archivePath, "err", err)
		}
	}
}

func getClickpackInfo(path string) (int64, bool, string, int, error) {
	var total int64
	hasNoise := false
	readme := ""
	soundCount := 0
	err := filepath.WalkDir(path, func(fp string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		name := d.Name()
		lower := strings.ToLower(name)
		if _, ok := soundExtensions[strings.ToLower(filepath.Ext(name))]; ok {
			soundCount++
		}
		for _, noise := range noiseFiles {
			if strings.Contains(lower, noise) {
				hasNoise = true
				break
			}
		}
		if readme == "" && strings.HasSuffix(name, ".txt") {
			data, err := os.ReadFile(fp)
			if err != nil {
				return err
			}
			readme = string(data)
		}
		total += info.Size()
		return nil
	})
	return total, hasNoise, readme, soundCount, err
}

func writeReproZip(dirPath, zipPath string) error {
	out, err := os.Create(zipPath)
	if err != nil {
		return fmt.Errorf("failed to create zip %q: %w", zipPath, err)
	}
	defer out.Close()

	var central []zipCentralRecord

	if err := filepath.WalkDir(dirPath, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dirPath, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		offset, err := out.Seek(0, io.SeekCurrent)
		if err != nil {
			return err
		}
		record, err := writeStoredLocalZipFile(out, rel, data, uint32(offset))
		if err != nil {
			return err
		}
		central = append(central, record)
		return nil
	}); err != nil {
		return err
	}

	centralOffset, err := out.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	for _, record := range central {
		if err := writeStoredCentralZipFile(out, record); err != nil {
			return err
		}
	}
	centralEnd, err := out.Seek(0, io.SeekCurrent)
	if err != nil {
		return err
	}
	return writeZipEnd(out, uint16(len(central)), uint32(centralEnd-centralOffset), uint32(centralOffset))
}

type zipCentralRecord struct {
	name        []byte
	flags       uint16
	crc         uint32
	size        uint32
	localOffset uint32
}

func writeStoredLocalZipFile(w io.Writer, name string, data []byte, offset uint32) (zipCentralRecord, error) {
	nameBytes, flags := pythonZipName(name)
	if len(data) > int(^uint32(0)) {
		return zipCentralRecord{}, fmt.Errorf("file %q is too large for zip32", name)
	}
	record := zipCentralRecord{
		name:        nameBytes,
		flags:       flags,
		crc:         crc32.ChecksumIEEE(data),
		size:        uint32(len(data)),
		localOffset: offset,
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(0x04034b50)); err != nil {
		return record, err
	}
	fields := []uint16{
		20,
		record.flags,
		0,
		0,
		33,
	}
	for _, field := range fields {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return record, err
		}
	}
	for _, field := range []uint32{record.crc, record.size, record.size} {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return record, err
		}
	}
	for _, field := range []uint16{uint16(len(record.name)), 0} {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return record, err
		}
	}
	if _, err := w.Write(record.name); err != nil {
		return record, err
	}
	_, err := w.Write(data)
	return record, err
}

func writeStoredCentralZipFile(w io.Writer, record zipCentralRecord) error {
	if err := binary.Write(w, binary.LittleEndian, uint32(0x02014b50)); err != nil {
		return err
	}
	fields16 := []uint16{
		20,
		20,
		record.flags,
		0,
		0,
		33,
	}
	for _, field := range fields16 {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return err
		}
	}
	for _, field := range []uint32{record.crc, record.size, record.size} {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return err
		}
	}
	for _, field := range []uint16{uint16(len(record.name)), 0, 0, 0, 0} {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return err
		}
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(0644<<16)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, record.localOffset); err != nil {
		return err
	}
	_, err := w.Write(record.name)
	return err
}

func writeZipEnd(w io.Writer, count uint16, centralSize, centralOffset uint32) error {
	if err := binary.Write(w, binary.LittleEndian, uint32(0x06054b50)); err != nil {
		return err
	}
	for _, field := range []uint16{0, 0, count, count} {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return err
		}
	}
	for _, field := range []uint32{centralSize, centralOffset} {
		if err := binary.Write(w, binary.LittleEndian, field); err != nil {
			return err
		}
	}
	return binary.Write(w, binary.LittleEndian, uint16(0))
}

func pythonZipName(name string) ([]byte, uint16) {
	for _, r := range name {
		if r > 127 {
			return []byte(name), 0x800
		}
	}
	return []byte(name), 0
}

func md5File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func commandError(msg string, cmd *exec.Cmd, err error) error {
	return fmt.Errorf("%s `%s`: %w", msg, strings.Join(cmd.Args, " "), err)
}

func pythonISOFormat(t time.Time) string {
	t = t.UTC()
	micro := t.Nanosecond() / 1000
	if micro == 0 {
		return t.Format("2006-01-02T15:04:05") + "+00:00"
	}
	return fmt.Sprintf("%s.%06d+00:00", t.Format("2006-01-02T15:04:05"), micro)
}

type orderedDB struct {
	root       *orderedObject
	clickpacks *orderedObject
}

func loadOrderedDB(path string) (*orderedDB, error) {
	var root *orderedObject
	if data, err := os.ReadFile(path); err == nil {
		value, err := parseOrderedJSON(data)
		if err != nil {
			return nil, fmt.Errorf("failed to parse %s: %w", path, err)
		}
		var ok bool
		root, ok = value.(*orderedObject)
		if !ok {
			return nil, fmt.Errorf("%s must contain a JSON object", path)
		}
	} else if errors.Is(err, os.ErrNotExist) {
		root = &orderedObject{}
	} else {
		return nil, fmt.Errorf("failed to read %s: %w", path, err)
	}

	defaults := []orderedMember{
		{key: "updated_at_iso", value: stringValue("")},
		{key: "updated_at_unix", value: numberValue("0")},
		{key: "version", value: numberValue("0")},
		{key: "clickpacks", value: &orderedObject{}},
		{key: "hiatus", value: stringValue(hiatusURL)},
	}
	for _, def := range defaults {
		if _, ok := root.get(def.key); !ok {
			root.set(def.key, def.value)
		}
	}

	clickpacksValue, _ := root.get("clickpacks")
	clickpacks, ok := clickpacksValue.(*orderedObject)
	if !ok {
		return nil, fmt.Errorf("clickpacks must be a JSON object")
	}
	return &orderedDB{root: root, clickpacks: clickpacks}, nil
}

func (db *orderedDB) clickpackNames() []string {
	names := make([]string, 0, len(db.clickpacks.members))
	for _, member := range db.clickpacks.members {
		names = append(names, member.key)
	}
	return names
}

func (db *orderedDB) clickpack(name string) *orderedObject {
	value, _ := db.clickpacks.get(name)
	obj, _ := value.(*orderedObject)
	return obj
}

func (db *orderedDB) hasClickpack(name string) bool {
	_, ok := db.clickpacks.get(name)
	return ok
}

func (db *orderedDB) setClickpack(name string, entry *orderedObject) {
	db.clickpacks.set(name, entry)
}

func (db *orderedDB) sortClickpacks() {
	sort.SliceStable(db.clickpacks.members, func(i, j int) bool {
		return strings.ToLower(db.clickpacks.members[i].key) < strings.ToLower(db.clickpacks.members[j].key)
	})
}

func (db *orderedDB) setTop(key string, value orderedValue) {
	db.root.set(key, value)
}

func (db *orderedDB) version() int64 {
	value, ok := db.root.get("version")
	if !ok {
		return 0
	}
	n, ok := value.(numberValue)
	if !ok {
		return 0
	}
	i, _ := strconv.ParseInt(string(n), 10, 64)
	return i
}

func (db *orderedDB) uncompressedSizes() map[int64]bool {
	sizes := map[int64]bool{}
	for _, member := range db.clickpacks.members {
		obj, ok := member.value.(*orderedObject)
		if !ok {
			continue
		}
		value, ok := obj.get("uncompressed_size")
		if !ok {
			continue
		}
		n, ok := value.(numberValue)
		if !ok {
			continue
		}
		i, err := strconv.ParseInt(string(n), 10, 64)
		if err == nil {
			sizes[i] = true
		}
	}
	return sizes
}

func (db *orderedDB) write(path string) error {
	var buf bytes.Buffer
	db.root.write(&buf, 0)
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}
	return nil
}

type orderedValue interface {
	write(*bytes.Buffer, int)
}

type orderedMember struct {
	key   string
	value orderedValue
}

type orderedObject struct {
	members []orderedMember
}

func (o *orderedObject) get(key string) (orderedValue, bool) {
	for _, member := range o.members {
		if member.key == key {
			return member.value, true
		}
	}
	return nil, false
}

func (o *orderedObject) set(key string, value orderedValue) {
	for i := range o.members {
		if o.members[i].key == key {
			o.members[i].value = value
			return
		}
	}
	o.members = append(o.members, orderedMember{key: key, value: value})
}

func (o *orderedObject) write(buf *bytes.Buffer, indent int) {
	buf.WriteByte('{')
	if len(o.members) > 0 {
		buf.WriteByte('\n')
	}
	for i, member := range o.members {
		writeIndent(buf, indent+4)
		writeJSONString(buf, member.key)
		buf.WriteString(": ")
		member.value.write(buf, indent+4)
		if i != len(o.members)-1 {
			buf.WriteByte(',')
		}
		buf.WriteByte('\n')
	}
	if len(o.members) > 0 {
		writeIndent(buf, indent)
	}
	buf.WriteByte('}')
}

type orderedArray []orderedValue

func (a orderedArray) write(buf *bytes.Buffer, indent int) {
	buf.WriteByte('[')
	if len(a) > 0 {
		buf.WriteByte('\n')
	}
	for i, value := range a {
		writeIndent(buf, indent+4)
		value.write(buf, indent+4)
		if i != len(a)-1 {
			buf.WriteByte(',')
		}
		buf.WriteByte('\n')
	}
	if len(a) > 0 {
		writeIndent(buf, indent)
	}
	buf.WriteByte(']')
}

type stringValue string
type numberValue string
type boolValue bool
type nullValue struct{}

func (v stringValue) write(buf *bytes.Buffer, _ int) { writeJSONString(buf, string(v)) }
func (v numberValue) write(buf *bytes.Buffer, _ int) { buf.WriteString(string(v)) }
func (v boolValue) write(buf *bytes.Buffer, _ int) {
	if bool(v) {
		buf.WriteString("true")
	} else {
		buf.WriteString("false")
	}
}
func (nullValue) write(buf *bytes.Buffer, _ int) { buf.WriteString("null") }

func parseOrderedJSON(data []byte) (orderedValue, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	value, err := parseOrderedValue(dec)
	if err != nil {
		return nil, err
	}
	if dec.More() {
		return nil, fmt.Errorf("unexpected extra JSON content")
	}
	return value, nil
}

func parseOrderedValue(dec *json.Decoder) (orderedValue, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := &orderedObject{}
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyTok.(string)
				if !ok {
					return nil, fmt.Errorf("expected object key")
				}
				value, err := parseOrderedValue(dec)
				if err != nil {
					return nil, err
				}
				obj.members = append(obj.members, orderedMember{key: key, value: value})
			}
			_, err := dec.Token()
			return obj, err
		case '[':
			var arr orderedArray
			for dec.More() {
				value, err := parseOrderedValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, value)
			}
			_, err := dec.Token()
			return arr, err
		default:
			return nil, fmt.Errorf("unexpected delimiter %q", t)
		}
	case string:
		return stringValue(t), nil
	case json.Number:
		return numberValue(t.String()), nil
	case bool:
		return boolValue(t), nil
	case nil:
		return nullValue{}, nil
	default:
		return nil, fmt.Errorf("unexpected token %T", tok)
	}
}

func writeIndent(buf *bytes.Buffer, indent int) {
	for i := 0; i < indent; i++ {
		buf.WriteByte(' ')
	}
}

func writeJSONString(buf *bytes.Buffer, s string) {
	buf.WriteString(strconv.QuoteToASCII(s))
}
