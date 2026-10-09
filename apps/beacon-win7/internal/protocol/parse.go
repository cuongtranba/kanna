package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
)

// DecodeJSON parses one JSON value the way JSON.parse does, keeping numbers
// as json.Number so that no precision is lost before a field is typed.
func DecodeJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("protocol: trailing data after JSON value")
	}
	return value, nil
}

// ParseFrame decodes and validates one frame. It returns false for anything
// parseBeaconFrame in TypeScript would turn into null.
func ParseFrame(data []byte) (Frame, bool) {
	value, err := DecodeJSON(data)
	if err != nil {
		return nil, false
	}
	return ParseFrameValue(value)
}

// ParseFrameValue validates an already decoded JSON value (as produced by
// DecodeJSON) as a frame.
func ParseFrameValue(value any) (Frame, bool) {
	frame, ok := parseFrameValue(value)
	if !ok {
		return nil, false
	}
	return frame, true
}

func parseFrameValue(value any) (Frame, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	kind, ok := readString(object, "kind")
	if !ok {
		return nil, false
	}
	switch kind {
	case KindHello:
		return parseHello(object)
	case KindIncompatible:
		return parseIncompatible(object)
	case KindChallenge:
		nonce, ok := readString(object, "nonce")
		return Challenge{Nonce: nonce}, ok
	case KindAuth:
		signature, ok := readString(object, "signature")
		return Auth{Signature: signature}, ok
	case KindReady:
		return parseReady(object)
	case KindRefused:
		reason, ok := readString(object, "reason")
		if !ok || (reason != RefusalUnknownBeacon && reason != RefusalDisabled) {
			return nil, false
		}
		return Refused{Reason: reason}, true
	case KindScope:
		scope, ok := parseScope(object["scope"])
		return ScopeFrame{Scope: scope}, ok
	case KindSetScope:
		change, ok := parseScopeChange(object["change"])
		return SetScope{Change: change}, ok
	case KindUnpair:
		return Unpair{}, true
	case KindPing:
		return Ping{}, true
	case KindPong:
		return Pong{}, true
	case KindRequest:
		return parseRequestFrame(object)
	case KindStdout, KindStderr:
		return parseOutput(object, kind)
	case KindExit:
		id, idOK := readString(object, "id")
		code, codeOK := readNumber(object, "code")
		return Exit{ID: id, Code: code}, idOK && codeOK
	case KindResult:
		id, idOK := readString(object, "id")
		result, present := object["result"]
		return Result{ID: id, Result: result}, idOK && present
	case KindError:
		id, idOK := readString(object, "id")
		message, messageOK := readString(object, "message")
		return ErrorFrame{ID: id, Message: message}, idOK && messageOK
	default:
		return nil, false
	}
}

func readString(object map[string]any, key string) (string, bool) {
	value, ok := object[key].(string)
	return value, ok
}

func readBool(object map[string]any, key string) (bool, bool) {
	value, ok := object[key].(bool)
	return value, ok
}

func readNumber(object map[string]any, key string) (float64, bool) {
	return numberValue(object[key])
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseFloat(string(typed), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return 0, false
		}
		return parsed, true
	case float64:
		return typed, true
	default:
		return 0, false
	}
}

func stringList(value any) ([]string, bool) {
	items, ok := value.([]any)
	if !ok {
		return nil, false
	}
	list := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			return nil, false
		}
		list = append(list, text)
	}
	return list, true
}

func readStringList(object map[string]any, key string) ([]string, bool) {
	return stringList(object[key])
}

func optionalString(object map[string]any, key string) (*string, bool) {
	if _, present := object[key]; !present {
		return nil, true
	}
	value, ok := readString(object, key)
	if !ok {
		return nil, false
	}
	return &value, true
}

func optionalNumber(object map[string]any, key string) (*float64, bool) {
	if _, present := object[key]; !present {
		return nil, true
	}
	value, ok := readNumber(object, key)
	if !ok {
		return nil, false
	}
	return &value, true
}

func optionalBool(object map[string]any, key string) (*bool, bool) {
	if _, present := object[key]; !present {
		return nil, true
	}
	value, ok := readBool(object, key)
	if !ok {
		return nil, false
	}
	return &value, true
}

func optionalStringList(object map[string]any, key string) (*[]string, bool) {
	if _, present := object[key]; !present {
		return nil, true
	}
	value, ok := readStringList(object, key)
	if !ok {
		return nil, false
	}
	return &value, true
}

func parseHello(object map[string]any) (Frame, bool) {
	beaconID, idOK := readString(object, "beaconId")
	protocolVersion, versionOK := readNumber(object, "protocolVersion")
	beaconVersion, beaconVersionOK := readString(object, "beaconVersion")
	os, osOK := readString(object, "os")
	osOK = osOK && (os == OSDarwin || os == OSLinux || os == OSWindows)
	if !idOK || !versionOK || !beaconVersionOK || !osOK {
		return nil, false
	}
	return Hello{BeaconID: beaconID, ProtocolVersion: protocolVersion, BeaconVersion: beaconVersion, OS: os}, true
}

func parseIncompatible(object map[string]any) (Frame, bool) {
	minSupported, minOK := readNumber(object, "minSupported")
	downloadURL, urlOK := optionalString(object, "downloadUrl")
	if !minOK || !urlOK {
		return nil, false
	}
	return Incompatible{MinSupported: minSupported, DownloadURL: downloadURL}, true
}

func parseReady(object map[string]any) (Frame, bool) {
	scope, scopeOK := parseScope(object["scope"])
	protocolVersion, versionOK := optionalNumber(object, "protocolVersion")
	if !scopeOK || !versionOK {
		return nil, false
	}
	return Ready{Scope: scope, ProtocolVersion: protocolVersion}, true
}

func parseScope(value any) (Scope, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return Scope{}, false
	}
	exec, execOK := readBool(object, "exec")
	execAllowlist, allowlistOK := readStringList(object, "execAllowlist")
	autoRunScripts, autoOK := readBool(object, "autoRunScripts")
	trustedScriptHashes, trustedOK := []string{}, true
	if _, present := object["trustedScriptHashes"]; present {
		trustedScriptHashes, trustedOK = readStringList(object, "trustedScriptHashes")
	}
	readRoots, readOK := readStringList(object, "readRoots")
	writeRoots, writeOK := readStringList(object, "writeRoots")
	perCallTimeoutMs, timeoutOK := readNumber(object, "perCallTimeoutMs")
	outputByteCap, capOK := readNumber(object, "outputByteCap")
	maxConcurrent, concurrentOK := readNumber(object, "maxConcurrent")
	valid := execOK && allowlistOK && autoOK && trustedOK && readOK && writeOK && timeoutOK && capOK && concurrentOK
	if !valid {
		return Scope{}, false
	}
	return Scope{
		Exec:                exec,
		ExecAllowlist:       execAllowlist,
		AutoRunScripts:      autoRunScripts,
		TrustedScriptHashes: trustedScriptHashes,
		ReadRoots:           readRoots,
		WriteRoots:          writeRoots,
		PerCallTimeoutMs:    perCallTimeoutMs,
		OutputByteCap:       outputByteCap,
		MaxConcurrent:       maxConcurrent,
	}, true
}

func parseScopeChange(value any) (ScopeChange, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return ScopeChange{}, false
	}
	readRoots, readOK := optionalStringList(object, "readRoots")
	exec, execOK := optionalBool(object, "exec")
	autoRunScripts, autoOK := optionalBool(object, "autoRunScripts")
	if !readOK || !execOK || !autoOK {
		return ScopeChange{}, false
	}
	return ScopeChange{ReadRoots: readRoots, Exec: exec, AutoRunScripts: autoRunScripts}, true
}

func parseRequestFrame(object map[string]any) (Frame, bool) {
	id, idOK := readString(object, "id")
	request, requestOK := parseRequest(object["request"])
	if !idOK || !requestOK {
		return nil, false
	}
	return RequestFrame{ID: id, Request: request}, true
}

func parseRequest(value any) (Request, bool) {
	object, ok := value.(map[string]any)
	if !ok {
		return Request{}, false
	}
	op, _ := readString(object, "op")
	switch op {
	case OpExec:
		cmd, cmdOK := readString(object, "cmd")
		args, argsOK := readStringList(object, "args")
		cwd, cwdOK := optionalString(object, "cwd")
		return Request{Op: op, Cmd: cmd, Args: args, Cwd: cwd}, cmdOK && argsOK && cwdOK
	case OpScript:
		body, bodyOK := readString(object, "body")
		return Request{Op: op, Body: body}, bodyOK
	case OpRead:
		path, pathOK := readString(object, "path")
		offset, offsetOK := readNumber(object, "offset")
		limit, limitOK := readNumber(object, "limit")
		return Request{Op: op, Path: path, Offset: offset, Limit: limit}, pathOK && offsetOK && limitOK
	case OpGrep:
		root, rootOK := readString(object, "root")
		pattern, patternOK := readString(object, "pattern")
		return Request{Op: op, Root: root, Pattern: pattern}, rootOK && patternOK
	case OpFetch:
		path, pathOK := readString(object, "path")
		chunkFrom, chunkOK := optionalNumber(object, "chunkFrom")
		return Request{Op: op, Path: path, ChunkFrom: chunkFrom}, pathOK && chunkOK
	case OpStat, OpGlob:
		path, pathOK := readString(object, "path")
		return Request{Op: op, Path: path}, pathOK
	case OpUpload:
		path, pathOK := readString(object, "path")
		ticket, ticketOK := readTicket(object)
		return Request{Op: op, Path: path, Ticket: ticket}, pathOK && ticketOK
	case OpDownload:
		path, pathOK := readString(object, "path")
		ticket, ticketOK := readTicket(object)
		size, sizeOK := readByteCount(object, "size")
		digest, digestOK := readSha256(object, "sha256")
		overwrite, overwriteOK := readBool(object, "overwrite")
		return Request{Op: op, Path: path, Ticket: ticket, Size: size, Sha256: digest, Overwrite: overwrite},
			pathOK && ticketOK && sizeOK && digestOK && overwriteOK
	default:
		return Request{}, false
	}
}

func readTicket(object map[string]any) (string, bool) {
	ticket, ok := readString(object, "ticket")
	return ticket, ok && ticket != ""
}

// readByteCount reads a non-negative integer, the shape of a file size.
func readByteCount(object map[string]any, key string) (float64, bool) {
	value, ok := readNumber(object, key)
	if !ok || value < 0 || math.IsInf(value, 0) || value != math.Trunc(value) {
		return 0, false
	}
	return value, true
}

// readSha256 reads 64 lowercase hexadecimal digits.
func readSha256(object map[string]any, key string) (string, bool) {
	value, ok := readString(object, key)
	if !ok || len(value) != 64 {
		return "", false
	}
	for index := 0; index < len(value); index++ {
		c := value[index]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return "", false
		}
	}
	return value, true
}

func parseOutput(object map[string]any, kind string) (Frame, bool) {
	id, idOK := readString(object, "id")
	chunk, chunkOK := readString(object, "chunk")
	if !idOK || !chunkOK {
		return nil, false
	}
	if kind == KindStdout {
		return Stdout{ID: id, Chunk: chunk}, true
	}
	return Stderr{ID: id, Chunk: chunk}, true
}

type scopeJSON Scope

// MarshalJSON encodes every list as an array, never null.
func (s Scope) MarshalJSON() ([]byte, error) {
	encoded := scopeJSON(s)
	for _, list := range []*[]string{
		&encoded.ExecAllowlist, &encoded.TrustedScriptHashes, &encoded.ReadRoots, &encoded.WriteRoots,
	} {
		if *list == nil {
			*list = []string{}
		}
	}
	return marshal(encoded)
}
