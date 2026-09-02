# -*- coding: utf-8 -*-

# Review Heatmap Add-on for Anki
#
# Copyright (C) 2016-2022  Aristotelis P. <https//glutanimate.com/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version, with the additions
# listed at the end of the accompanied license file.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# NOTE: This program is subject to certain additional terms pursuant to
# Section 7 of the GNU Affero General Public License.  You should have
# received a copy of these additional terms immediately following the
# terms and conditions of the GNU Affero General Public License which
# accompanied this program.
#
# If not, please request a copy through one of the means of contact
# listed here: <https://glutanimate.com/contact/>.
#
# Any modifications to this file must keep this entire header intact.

"""
Per-deck heatmap color overrides, set via the deck browser's context menu
"""

from typing import Optional

from aqt.qt import QMenu

from ..config import config, heatmap_colors


def _on_deck_browser_will_show_options_menu(menu: QMenu, deck_id: int):
    deck_colors = config["synced"].setdefault("deckcolors", {})
    current = deck_colors.get(str(deck_id))

    submenu = menu.addMenu("Heatmap Color")

    default_action = submenu.addAction("Use default theme")
    default_action.setCheckable(True)
    default_action.setChecked(current is None)
    default_action.triggered.connect(
        lambda _, deck_id=deck_id: _set_deck_color(deck_id, None)
    )

    submenu.addSeparator()

    for key, color in heatmap_colors.items():
        action = submenu.addAction(color["label"])
        action.setCheckable(True)
        action.setChecked(current == key)
        action.triggered.connect(
            lambda _, deck_id=deck_id, key=key: _set_deck_color(deck_id, key)
        )


def _set_deck_color(deck_id: int, color: Optional[str]):
    deck_colors = config["synced"].setdefault("deckcolors", {})
    if color is None:
        deck_colors.pop(str(deck_id), None)
    else:
        deck_colors[str(deck_id)] = color
    config.save()


def initialize_deck_colors():
    from aqt.gui_hooks import deck_browser_will_show_options_menu

    deck_browser_will_show_options_menu.append(_on_deck_browser_will_show_options_menu)
