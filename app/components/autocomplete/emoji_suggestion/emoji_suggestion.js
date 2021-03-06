// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import {
    FlatList,
    Platform,
    Text,
    View,
} from 'react-native';
import Fuse from 'fuse.js';

import AutocompleteDivider from '@components/autocomplete/autocomplete_divider';
import Emoji from '@components/emoji';
import TouchableWithFeedback from '@components/touchable_with_feedback';
import {BuiltInEmojis} from '@utils/emojis';
import {getEmojiByName, compareEmojis} from '@utils/emoji_utils';
import {makeStyleSheetFromTheme} from '@utils/theme';

const EMOJI_REGEX = /(^|\s|^\+|^-)(:([^:\s]*))$/i;
const EMOJI_REGEX_WITHOUT_PREFIX = /\B(:([^:\s]*))$/i;

const options = {
    shouldSort: true,
    threshold: 0.3,
    location: 0,
    distance: 100,
    minMatchCharLength: 2,
    maxPatternLength: 32,
};

export default class EmojiSuggestion extends PureComponent {
    static propTypes = {
        actions: PropTypes.shape({
            addReactionToLatestPost: PropTypes.func.isRequired,
            autocompleteCustomEmojis: PropTypes.func.isRequired,
        }).isRequired,
        cursorPosition: PropTypes.number,
        customEmojisEnabled: PropTypes.bool,
        emojis: PropTypes.array.isRequired,
        isSearch: PropTypes.bool,
        maxListHeight: PropTypes.number,
        theme: PropTypes.object.isRequired,
        onChangeText: PropTypes.func.isRequired,
        onResultCountChange: PropTypes.func.isRequired,
        rootId: PropTypes.string,
        value: PropTypes.string,
        nestedScrollEnabled: PropTypes.bool,
    };

    static defaultProps = {
        defaultChannel: {},
        value: '',
    };

    state = {
        active: false,
        dataSource: [],
    };

    constructor(props) {
        super(props);

        this.matchTerm = '';
        const list = props.emojis || [];
        this.fuse = new Fuse(list, options);
    }

    componentDidUpdate(prevProps) {
        if (this.props.isSearch) {
            return;
        }

        const {cursorPosition, emojis, value} = this.props;
        const match = value.substring(0, cursorPosition).match(EMOJI_REGEX);

        if (prevProps.emojis !== emojis) {
            const list = emojis || [];
            this.fuse = new Fuse(list, options);
        }

        if (!match || this.state.emojiComplete) {
            this.resetAutocomplete();
            return;
        }

        const oldMatchTerm = this.matchTerm;
        this.matchTerm = match[3] || '';
        if (this.matchTerm !== oldMatchTerm || match[2] === ':') {
            if (this.props.customEmojisEnabled) {
                this.props.actions.autocompleteCustomEmojis(this.matchTerm);
            }
            this.searchEmoji(this.matchTerm);
        }
    }

    completeSuggestion = (emoji) => {
        const {actions, cursorPosition, onChangeText, value, rootId} = this.props;
        const emojiPart = value.substring(0, cursorPosition);

        if (emojiPart.startsWith('+:')) {
            actions.addReactionToLatestPost(emoji, rootId);
            onChangeText('');
        } else {
            // We are going to set a double : on iOS to prevent the auto correct from taking over and replacing it
            // with the wrong value, this is a hack but I could not found another way to solve it
            let completedDraft;
            let prefix = ':';
            if (Platform.OS === 'ios') {
                prefix = '::';
            }

            const emojiData = getEmojiByName(emoji);
            if (emojiData?.filename && !BuiltInEmojis.includes(emojiData.filename)) {
                const codeArray = emojiData.filename.split('-');
                const code = codeArray.reduce((acc, c) => {
                    return acc + String.fromCodePoint(parseInt(c, 16));
                }, '');
                completedDraft = emojiPart.replace(EMOJI_REGEX_WITHOUT_PREFIX, `${code} `);
            } else {
                completedDraft = emojiPart.replace(EMOJI_REGEX_WITHOUT_PREFIX, `${prefix}${emoji}: `);
            }

            if (value.length > cursorPosition) {
                completedDraft += value.substring(cursorPosition);
            }

            onChangeText(completedDraft);

            if (Platform.OS === 'ios' && (!emojiData?.filename || BuiltInEmojis.includes(emojiData?.filename))) {
                // This is the second part of the hack were we replace the double : with just one
                // after the auto correct vanished
                setTimeout(() => {
                    onChangeText(completedDraft.replace(`::${emoji}: `, `:${emoji}: `));
                });
            }
        }

        this.setState({
            active: false,
            emojiComplete: true,
        });
    };

    getItemLayout = ({index}) => ({length: 40, offset: 40 * index, index})

    handleFuzzySearch = (matchTerm) => {
        const {emojis} = this.props;

        clearTimeout(this.searchTermTimeout);
        this.searchTermTimeout = setTimeout(() => {
            const results = this.fuse.search(matchTerm.toLowerCase()).map((r) => r.refIndex);
            const data = results.map((index) => emojis[index]);
            this.setEmojiData(data, matchTerm);
        }, 100);
    };

    keyExtractor = (item) => item;

    renderItem = ({item}) => {
        const style = getStyleFromTheme(this.props.theme);

        return (
            <TouchableWithFeedback
                onPress={() => this.completeSuggestion(item)}
                style={style.row}
                type={'opacity'}
            >
                <View style={style.emoji}>
                    <Emoji
                        emojiName={item}
                        textStyle={style.emojiText}
                        size={20}
                    />
                </View>
                <Text style={style.emojiName}>{`:${item}:`}</Text>
            </TouchableWithFeedback>
        );
    };

    resetAutocomplete = () => {
        this.setState({
            active: false,
            emojiComplete: false,
        });

        this.props.onResultCountChange(0);
    }

    searchEmoji = (matchTerm) => {
        if (matchTerm.length) {
            this.handleFuzzySearch(matchTerm);
        } else {
            this.setEmojiData(this.props.emojis);
        }
    }

    setEmojiData = (data, matchTerm = null) => {
        let sorter = compareEmojis;
        if (matchTerm) {
            sorter = (a, b) => compareEmojis(a, b, matchTerm);
        }

        this.setState({
            active: data.length > 0,
            dataSource: data.sort(sorter),
        });

        this.props.onResultCountChange(data.length);
    };

    render() {
        const {maxListHeight, theme, nestedScrollEnabled} = this.props;

        if (!this.state.active) {
            // If we are not in an active state return null so nothing is rendered
            // other components are not blocked.
            return null;
        }

        const style = getStyleFromTheme(theme);

        return (
            <FlatList
                keyboardShouldPersistTaps='always'
                style={[style.listView, {maxHeight: maxListHeight}]}
                extraData={this.state}
                data={this.state.dataSource}
                keyExtractor={this.keyExtractor}
                renderItem={this.renderItem}
                ItemSeparatorComponent={AutocompleteDivider}
                pageSize={10}
                initialListSize={10}
                nestedScrollEnabled={nestedScrollEnabled}
            />
        );
    }
}

const getStyleFromTheme = makeStyleSheetFromTheme((theme) => {
    return {
        emoji: {
            marginRight: 5,
        },
        emojiName: {
            fontSize: 13,
            color: theme.centerChannelColor,
        },
        emojiText: {
            color: '#000',
            fontWeight: 'bold',
        },
        listView: {
            flex: 1,
            backgroundColor: theme.centerChannelBg,
        },
        row: {
            height: 40,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 8,
            backgroundColor: theme.centerChannelBg,
        },
    };
});
