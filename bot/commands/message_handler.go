package commands

import (
	"log/slog"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/disgoorg/disgo/bot"
	"github.com/disgoorg/disgo/discord"
	"github.com/disgoorg/disgo/events"
	"github.com/disgoorg/snowflake/v2"
)

var clickpackChannelIDs = []snowflake.ID{952187055092416582, 1383785285074292848}

//const clickpackChannelID = 783959799347019817
//const modChannelID = 908268938482286634

var discordMessageURLRe = regexp.MustCompile(`discord(?:app)?\.com/channels/\d+/(\d+)/(\d+)`)

func OnMessageCreate(event *events.MessageCreate) {
	if event.ChannelID != primaryClickpackChannelID() {
		return
	}

	handleClickpackMessage(event.Client(), event.Message)
}

func OnReady(event *events.Ready) {
	go scanMissedClickpacks(event.Client())
}

func handleClickpackMessage(client bot.Client, msg discord.Message) {
	for i, attachment := range msg.Attachments {
		if attachment.URL == "" {
			continue
		}
		for _, ext := range archiveExtensions {
			if len(attachment.Filename) > len(ext) && attachment.Filename[len(attachment.Filename)-len(ext):] == ext {
				SendVerify(client, msg, strings.ReplaceAll(attachment.Filename, "_", " "), i)
			}
		}
	}
}

func scanMissedClickpacks(client bot.Client) {
	lastSeen := findLastVerifiedClickpackMessages(client)
	channelID := primaryClickpackChannelID()
	after := lastSeen[channelID]

	for {
		messages, err := client.Rest().GetMessages(channelID, 0, 0, after, 100)
		if err != nil {
			slog.Error("failed to scan clickpack channel", "err", err, "channelID", channelID)
			break
		}
		if len(messages) == 0 {
			break
		}

		sort.Slice(messages, func(i, j int) bool {
			return messages[i].ID < messages[j].ID
		})

		for _, msg := range messages {
			if msg.ID <= after {
				continue
			}
			handleClickpackMessage(client, msg)
			after = msg.ID
		}

		if len(messages) < 100 {
			break
		}
	}
}

func findLastVerifiedClickpackMessages(client bot.Client) map[snowflake.ID]snowflake.ID {
	primaryChannelID := primaryClickpackChannelID()
	lastSeen := map[snowflake.ID]snowflake.ID{primaryChannelID: 0}

	before := snowflake.ID(0)
	for {
		messages, err := client.Rest().GetMessages(modChannelID, 0, before, 0, 100)
		if err != nil {
			slog.Error("failed to scan approval channel", "err", err, "channelID", modChannelID)
			return lastSeen
		}
		if len(messages) == 0 {
			return lastSeen
		}

		for _, msg := range messages {
			for channelID, messageID := range referencedClickpackMessages(msg) {
				if channelID == primaryChannelID && messageID > lastSeen[channelID] {
					lastSeen[channelID] = messageID
				}
			}
		}

		if lastSeen[primaryChannelID] != 0 || len(messages) < 100 {
			return lastSeen
		}

		before = messages[len(messages)-1].ID
	}
}

func referencedClickpackMessages(msg discord.Message) map[snowflake.ID]snowflake.ID {
	refs := map[snowflake.ID]snowflake.ID{}

	for _, component := range msg.InteractiveComponents() {
		if !strings.HasPrefix(component.ID(), "/approve/") && !strings.HasPrefix(component.ID(), "/reject/") {
			continue
		}

		_, customID, ok := strings.Cut(component.ID()[1:], "/")
		if !ok {
			continue
		}
		messageID, channelID, _, _, ok := extractCustomID(customID)
		if ok {
			refs[channelID] = messageID
		}
	}

	for _, embed := range msg.Embeds {
		for _, match := range discordMessageURLRe.FindAllStringSubmatch(embed.Description, -1) {
			channelID, err := parseSnowflake(match[1])
			if err != nil {
				continue
			}
			messageID, err := parseSnowflake(match[2])
			if err != nil {
				continue
			}
			refs[channelID] = messageID
		}
	}

	return refs
}

func parseSnowflake(s string) (snowflake.ID, error) {
	id, err := strconv.ParseUint(s, 10, 64)
	return snowflake.ID(id), err
}

func primaryClickpackChannelID() snowflake.ID {
	return clickpackChannelIDs[0]
}
