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
Exports the currently rendered heatmap to an SVG file
"""

from typing import Optional
from urllib.parse import unquote

from aqt.qt import QFileDialog, QWidget
from aqt.utils import showWarning, tooltip


def invoke_export_heatmap(svg_payload: str, parent: Optional[QWidget] = None) -> None:
    svg_content = unquote(svg_payload)

    path, _ = QFileDialog.getSaveFileName(
        parent, "Export Heatmap", "review-heatmap.svg", "SVG images (*.svg)"
    )
    if not path:
        return

    if not path.lower().endswith(".svg"):
        path += ".svg"

    try:
        with open(path, "w", encoding="utf-8") as file:
            file.write(svg_content)
    except OSError as exc:
        showWarning(f"Could not save heatmap: {exc}", parent=parent)
        return

    tooltip("Heatmap exported successfully.", parent=parent)
